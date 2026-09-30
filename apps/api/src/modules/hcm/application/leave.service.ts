import { Injectable, OnModuleInit } from '@nestjs/common';
import { HCM_PERMISSIONS, HcmEvents, type LeaveListQuery, type SubmitLeaveRequest } from '@simorgh/contracts';
import { attachments, leaveRequests, leaveTypes, users, wfTasks, type LeaveStatus, type Tx } from '@simorgh/db';
import { jalaliMonthRange, jalaliYearRange, toJalali, todayIso } from '@simorgh/jalali';
import { and, between, desc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import { AuditService } from '../../../kernel/audit/audit.service.js';
import { CalendarService } from '../../../kernel/calendar/calendar.service.js';
import { DbService } from '../../../kernel/db/db.module.js';
import { ApiError } from '../../../kernel/http/api-error.js';
import type { TenantContext } from '../../../kernel/http/context.js';
import { ScopeService } from '../../../kernel/org/scope.service.js';
import { OutboxService } from '../../../kernel/outbox/outbox.service.js';
import { WorkflowEngine } from '../../../kernel/workflow/workflow.engine.js';
import { WorkflowRegistry, type WorkflowCompletion } from '../../../kernel/workflow/workflow.registry.js';
import { effectiveDays, iranianWeek, minutesBetween, round2, SITE_MINUTES } from '../domain/leave-rules.js';
import { BalanceService } from './balance.service.js';
import { HcmSetupService } from './hcm-setup.service.js';

export const LEAVE_DOC_TYPE = 'hcm.leave_request';
export const LEAVE_WORKFLOW = 'hcm.leave.approval';

type LeaveRow = typeof leaveRequests.$inferSelect;
const ACTIVE: LeaveStatus[] = ['pending', 'approved'];

/**
 * Leave, mission and hourly-leave requests (Kara leave/actions.ts). All of
 * Kara's checks are kept; approval runs through the kernel workflow:
 * unit manager → HR → final, as many levels as the leave type asks for.
 */
@Injectable()
export class LeaveService implements OnModuleInit {
  constructor(
    private readonly db: DbService,
    private readonly setup: HcmSetupService,
    private readonly balances: BalanceService,
    private readonly calendar: CalendarService,
    private readonly scope: ScopeService,
    private readonly workflow: WorkflowEngine,
    private readonly registry: WorkflowRegistry,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      {
        key: LEAVE_WORKFLOW,
        version: 1,
        docType: LEAVE_DOC_TYPE,
        steps: [
          {
            id: 'manager',
            label: { fa: 'مدیر بخش', en: 'Unit manager' },
            assignees: [{ kind: 'org_unit_manager' }, { kind: 'permission', key: HCM_PERMISSIONS['leave.approve'] }],
          },
          {
            id: 'hr',
            label: { fa: 'کارگزینی', en: 'HR' },
            assignees: [{ kind: 'permission', key: HCM_PERMISSIONS['leave.approve.hr'] }],
            when: [{ field: 'levels', op: 'gte', value: 2 }],
          },
          {
            id: 'final',
            label: { fa: 'مدیرعامل', en: 'Final approval' },
            assignees: [{ kind: 'permission', key: HCM_PERMISSIONS['leave.approve.final'] }],
            when: [{ field: 'levels', op: 'gte', value: 3 }],
          },
        ],
      },
      (tx, ctx, done) => this.onWorkflowDone(tx, ctx, done),
    );
  }

  submit(ctx: TenantContext, body: SubmitLeaveRequest) {
    return this.db.tenant(ctx, async (tx) => {
      const policy = await this.setup.ensureSeeded(tx);
      const [type] = await tx.select().from(leaveTypes).where(eq(leaveTypes.id, body.typeId));
      if (!type || !type.isActive) throw ApiError.badRequest('LEAVE_TYPE_INVALID', 'Unknown or inactive leave type');

      // ── what is being asked for ──
      const from = body.fromDate;
      let to = from;
      let fromTime: string | null = null;
      let toTime: string | null = null;
      if (type.unit === 'hour') {
        if (!body.fromTime || !body.toTime) throw ApiError.badRequest('TIME_REQUIRED', 'Give the start and end time');
        if (body.toTime <= body.fromTime) throw ApiError.badRequest('TIME_ORDER', 'The end time must be after the start');
        fromTime = body.fromTime;
        toTime = body.toTime;
      } else {
        to = body.toDate ?? from;
        if (to < from) throw ApiError.badRequest('DATE_ORDER', 'The end date must not be before the start');
      }
      if (type.requiresAttachment && !body.attachmentId) {
        throw ApiError.badRequest('ATTACHMENT_REQUIRED', 'This leave type needs a supporting document');
      }
      if (body.attachmentId) {
        const [file] = await tx.select().from(attachments).where(eq(attachments.id, body.attachmentId));
        if (!file || file.status !== 'stored' || file.createdBy !== ctx.userId) {
          throw ApiError.badRequest('ATTACHMENT_INVALID', 'Upload the document first; it must be your own upload');
        }
      }
      const mission = type.code === 'mission';
      if (mission && !body.mission) throw ApiError.badRequest('MISSION_DETAILS_REQUIRED', 'Give the origin and destination of the mission');

      // ── how much it costs ──
      const employment = await this.setup.employmentOf(tx, ctx.userId);
      const dailyMinutes = employment?.dailyWorkMinutes ?? SITE_MINUTES.hq;
      const days = await this.calendar.days(tx, from, to);
      const effective = effectiveDays({
        unit: type.unit,
        countsInnerHolidays: type.countsInnerHolidays,
        from,
        to,
        fromTime,
        toTime,
        isOff: (d) => days.isOff(d),
        dailyMinutes,
      });
      if (type.unit === 'day' && effective <= 0) throw ApiError.unprocessable('NO_WORKING_DAYS', 'The range has no working days to take off');
      if (type.unit === 'hour' && days.isOff(from)) throw ApiError.unprocessable('NOT_A_WORKING_DAY', 'Hourly leave is for working days');
      const jFrom = toJalali(from);

      // ── Kara's rules ──
      await this.requireNoOverlap(tx, ctx.userId, from, to, fromTime, toTime);
      const mine = and(eq(leaveRequests.userId, ctx.userId), eq(leaveRequests.typeId, type.id), inArray(leaveRequests.status, ACTIVE));

      // (a) hourly ceiling per day — counting what is already asked for that day
      if (type.unit === 'hour' && type.maxMinutesPerDay != null) {
        const sameDay = await tx
          .select({ fromTime: leaveRequests.fromTime, toTime: leaveRequests.toTime })
          .from(leaveRequests)
          .where(and(mine, eq(leaveRequests.fromDate, from)));
        const minutes = sameDay.reduce(
          (m, r) => m + minutesBetween(r.fromTime!.slice(0, 5), r.toTime!.slice(0, 5)),
          minutesBetween(fromTime!, toTime!),
        );
        if (minutes > type.maxMinutesPerDay) {
          throw ApiError.unprocessable(
            'LEAVE_DAILY_CAP',
            `Over the daily ceiling of ${type.maxMinutesPerDay} minutes; take the day as daily leave instead`,
          );
        }
      }
      // (b) occurrences per Jalali month
      if (type.maxCountPerMonth != null) {
        const m = jalaliMonthRange(jFrom.jy, jFrom.jm);
        if ((await this.count(tx, and(mine, between(leaveRequests.fromDate, m.from, m.to)))) >= type.maxCountPerMonth) {
          throw ApiError.unprocessable('LEAVE_MONTHLY_CAP', `Already ${type.maxCountPerMonth} of this leave type this month`);
        }
      }
      // (c) occurrences per week (Saturday to Friday)
      if (type.maxCountPerWeek != null) {
        const w = iranianWeek(from);
        if ((await this.count(tx, and(mine, between(leaveRequests.fromDate, w.from, w.to)))) >= type.maxCountPerWeek) {
          throw ApiError.unprocessable('LEAVE_WEEKLY_CAP', `Already ${type.maxCountPerWeek} of this leave type this week`);
        }
      }
      // (d) days per Jalali year for this type
      if (type.maxDaysPerYear != null) {
        const y = jalaliYearRange(jFrom.jy);
        const [{ total }] = (await tx
          .select({ total: sql<number>`coalesce(sum(${leaveRequests.effectiveDays}), 0)`.mapWith(Number) })
          .from(leaveRequests)
          .where(and(mine, between(leaveRequests.fromDate, y.from, y.to)))) as [{ total: number }];
        if (total + effective > Number(type.maxDaysPerYear)) {
          throw ApiError.unprocessable('LEAVE_YEARLY_CAP', `This would pass the ${type.maxDaysPerYear}-day yearly limit of this leave type`);
        }
      }
      // (e) entitlement balance, down to the allowed negative (مرخصی منفی).
      // Pending requests count too; Kara counted only approved ones, so
      // several requests filed together could each pass and together overdraw.
      if (type.deductsEntitlement) {
        const [b] = await this.balances.compute(tx, [ctx.userId], jFrom.jy, todayIso(), policy);
        const available = round2(b!.remaining - b!.pending);
        if (available - effective < -Number(policy.maxNegativeDays)) {
          throw ApiError.unprocessable(
            'INSUFFICIENT_BALANCE',
            `Not enough entitlement (available ${available} days; at most ${policy.maxNegativeDays} days below zero). Use unpaid leave instead`,
          );
        }
      }

      // ── record it and send it for approval ──
      const [row] = await tx
        .insert(leaveRequests)
        .values({
          tenantId: sql`core.current_tenant()`,
          userId: ctx.userId,
          typeId: type.id,
          kind: mission ? 'mission' : type.unit === 'hour' ? 'hourly' : 'leave',
          fromDate: from,
          toDate: to,
          fromTime,
          toTime,
          jalaliYear: jFrom.jy,
          effectiveDays: effective,
          reason: body.reason ?? null,
          attachmentId: body.attachmentId ?? null,
          details: mission ? body.mission : null,
        })
        .returning();
      if (body.attachmentId) {
        await tx.update(attachments).set({ ownerType: LEAVE_DOC_TYPE, ownerId: row!.id }).where(eq(attachments.id, body.attachmentId));
      }

      const [me] = await tx.select({ name: users.displayName }).from(users).where(eq(users.id, ctx.userId));
      const flow = await this.workflow.start(tx, ctx, {
        key: LEAVE_WORKFLOW,
        docId: row!.id,
        subjectUserId: ctx.userId,
        title: `${type.name}: ${me!.name}`,
        data: { levels: type.approvalLevels, days: effective, typeCode: type.code },
      });
      await tx.update(leaveRequests).set({ workflowInstanceId: flow.instanceId }).where(eq(leaveRequests.id, row!.id));

      const saved = await this.load(tx, row!.id);
      await this.audit.record(tx, ctx, { action: 'hcm.leave.submit', entityType: LEAVE_DOC_TYPE, entityId: row!.id, after: saved });
      await this.outbox.enqueue(tx, ctx, {
        type: HcmEvents.leaveRequested,
        subject: { type: LEAVE_DOC_TYPE, id: row!.id },
        data: { userId: ctx.userId, typeCode: type.code, fromDate: from, toDate: to, effectiveDays: effective },
      });
      return saved;
    });
  }

  /** The requester withdraws a request still waiting for approval. */
  cancel(ctx: TenantContext, id: string) {
    return this.db.tenant(ctx, async (tx) => {
      const [row] = await tx.select().from(leaveRequests).where(eq(leaveRequests.id, id));
      if (!row || row.userId !== ctx.userId) throw ApiError.notFound('LEAVE_NOT_FOUND', 'Leave request not found');
      if (row.status !== 'pending') throw ApiError.conflict('LEAVE_NOT_PENDING', 'Only a pending request can be withdrawn');
      // the workflow row is the lock: a decision racing this one either lands first
      // (and cancel reports the flow finished) or finds the flow cancelled
      await this.workflow.cancel(tx, ctx, row.workflowInstanceId!, 'withdrawn by the requester').catch((err: unknown) => {
        if (err instanceof ApiError && err.code === 'WORKFLOW_FINISHED') {
          throw ApiError.conflict('LEAVE_NOT_PENDING', 'Only a pending request can be withdrawn');
        }
        throw err;
      });
      return this.load(tx, id);
    });
  }

  /**
   * Requests: your own; someone's (`userId`) or everyone's you oversee
   * (`team`) through hcm.leave.view.
   */
  list(ctx: TenantContext, q: LeaveListQuery & { team?: boolean }) {
    return this.db.tenant(ctx, async (tx) => {
      let who;
      if (q.team) {
        who = this.scope.condition(await this.scope.area(tx, ctx, HCM_PERMISSIONS['leave.view']), leaveRequests.userId);
      } else {
        const userId = q.userId ?? ctx.userId;
        await this.setup.requireViewOver(tx, ctx, userId);
        who = eq(leaveRequests.userId, userId);
      }
      return tx
        .select({ r: leaveRequests, typeName: leaveTypes.name, typeCode: leaveTypes.code, userName: users.displayName })
        .from(leaveRequests)
        .innerJoin(leaveTypes, and(eq(leaveTypes.tenantId, leaveRequests.tenantId), eq(leaveTypes.id, leaveRequests.typeId)))
        .innerJoin(users, eq(users.id, leaveRequests.userId))
        .where(
          and(
            who,
            q.status ? eq(leaveRequests.status, q.status) : undefined,
            q.from ? gte(leaveRequests.toDate, q.from) : undefined,
            q.to ? lte(leaveRequests.fromDate, q.to) : undefined,
          ),
        )
        .orderBy(desc(leaveRequests.fromDate), desc(leaveRequests.createdAt))
        .limit(q.limit)
        .then((rows) => rows.map(({ r, ...rest }) => ({ ...r, ...rest })));
    });
  }

  /** One request with its approval trail — also for the people asked to approve it. */
  get(ctx: TenantContext, id: string) {
    return this.db.tenant(ctx, async (tx) => {
      const row = await this.load(tx, id).catch(() => null);
      if (!row) throw ApiError.notFound('LEAVE_NOT_FOUND', 'Leave request not found');
      if (row.userId !== ctx.userId && !(await this.isApprover(tx, ctx.userId, row.workflowInstanceId))) {
        await this.setup.requireViewOver(tx, ctx, row.userId).catch(() => {
          throw ApiError.notFound('LEAVE_NOT_FOUND', 'Leave request not found');
        });
      }
      const workflow = row.workflowInstanceId ? await this.workflow.viewIn(tx, row.workflowInstanceId) : null;
      return { ...row, workflow };
    });
  }

  /** The workflow finished: the request takes its outcome, in the same transaction. */
  private async onWorkflowDone(tx: Tx, ctx: TenantContext, done: WorkflowCompletion): Promise<void> {
    const status: LeaveStatus = done.outcome;
    const [row] = await tx
      .update(leaveRequests)
      .set({ status, decidedBy: done.actorUserId, decidedAt: new Date() })
      .where(and(eq(leaveRequests.id, done.docId), eq(leaveRequests.status, 'pending')))
      .returning();
    if (!row) return;
    await this.audit.record(tx, ctx, { action: `hcm.leave.${status}`, entityType: LEAVE_DOC_TYPE, entityId: row.id, after: { status, comment: done.comment } });
    const type = { approved: HcmEvents.leaveApproved, rejected: HcmEvents.leaveRejected, cancelled: HcmEvents.leaveCancelled }[done.outcome];
    await this.outbox.enqueue(tx, ctx, {
      type,
      subject: { type: LEAVE_DOC_TYPE, id: row.id },
      data: { userId: row.userId, fromDate: row.fromDate, toDate: row.toDate, fromTime: row.fromTime, toTime: row.toTime, effectiveDays: row.effectiveDays, kind: row.kind },
    });
  }

  /**
   * One person cannot be away twice at once: a day leave may not overlap any
   * other active request; hourly leave may not overlap day leave that day or
   * other hours.
   */
  private async requireNoOverlap(tx: Tx, userId: string, from: string, to: string, fromTime: string | null, toTime: string | null) {
    const others = await tx
      .select({ fromTime: leaveRequests.fromTime, toTime: leaveRequests.toTime })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.userId, userId),
          inArray(leaveRequests.status, ACTIVE),
          lte(leaveRequests.fromDate, to),
          gte(leaveRequests.toDate, from),
        ),
      );
    const clash = others.some((o) => {
      if (!fromTime || !o.fromTime) return true; // a whole day on either side
      return o.fromTime.slice(0, 5) < toTime! && fromTime < o.toTime!.slice(0, 5);
    });
    if (clash) throw ApiError.conflict('LEAVE_OVERLAP', 'You already have leave or a mission at this time');
  }

  private async count(tx: Tx, where: ReturnType<typeof and>): Promise<number> {
    const [r] = await tx.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(leaveRequests).where(where);
    return r!.n;
  }

  private async isApprover(tx: Tx, userId: string, instanceId: string | null): Promise<boolean> {
    if (!instanceId) return false;
    const [t] = await tx
      .select({ id: wfTasks.id })
      .from(wfTasks)
      .where(and(eq(wfTasks.instanceId, instanceId), eq(wfTasks.assigneeUserId, userId), ne(wfTasks.status, 'expired')))
      .limit(1);
    return !!t;
  }

  private async load(tx: Tx, id: string): Promise<LeaveRow & { typeName: string; typeCode: string }> {
    const [r] = await tx
      .select({ r: leaveRequests, typeName: leaveTypes.name, typeCode: leaveTypes.code })
      .from(leaveRequests)
      .innerJoin(leaveTypes, and(eq(leaveTypes.tenantId, leaveRequests.tenantId), eq(leaveTypes.id, leaveRequests.typeId)))
      .where(eq(leaveRequests.id, id));
    if (!r) throw ApiError.notFound('LEAVE_NOT_FOUND', 'Leave request not found');
    return { ...r.r, typeName: r.typeName, typeCode: r.typeCode };
  }
}
