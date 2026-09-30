import { Injectable } from '@nestjs/common';
import { HCM_PERMISSIONS, type LeaveBalance, type LedgerEntryRequest } from '@simorgh/contracts';
import { employments, leaveLedger, leaveRequests, leaveTypes, tenantMemberships, users, type Tx } from '@simorgh/db';
import { toJalali, todayIso } from '@simorgh/jalali';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../../../kernel/audit/audit.service.js';
import { DbService } from '../../../kernel/db/db.module.js';
import { ApiError } from '../../../kernel/http/api-error.js';
import type { TenantContext } from '../../../kernel/http/context.js';
import { ScopeService } from '../../../kernel/org/scope.service.js';
import { proratedAccrual, round2, SITE_MINUTES } from '../domain/leave-rules.js';
import { HcmSetupService, type LeavePolicy } from './hcm-setup.service.js';

/**
 * The entitlement balance (مانده مرخصی استحقاقی) per Jalali year:
 * accrued so far + carried in + ledger movements − approved leave. Pending
 * requests are reported apart and count against what can still be asked for.
 */
@Injectable()
export class BalanceService {
  constructor(
    private readonly db: DbService,
    private readonly setup: HcmSetupService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
  ) {}

  balance(ctx: TenantContext, userId = ctx.userId, jalaliYear?: number): Promise<LeaveBalance> {
    return this.db.tenant(ctx, async (tx) => {
      await this.setup.requireViewOver(tx, ctx, userId);
      const policy = await this.setup.ensureSeeded(tx);
      const today = todayIso();
      return (await this.compute(tx, [userId], jalaliYear ?? toJalali(today).jy, today, policy))[0]!;
    });
  }

  /** Everyone the caller's hcm.leave.view reaches (active members), for a year. */
  team(ctx: TenantContext, jalaliYear?: number): Promise<(LeaveBalance & { displayName: string })[]> {
    return this.db.tenant(ctx, async (tx) => {
      const policy = await this.setup.ensureSeeded(tx);
      const area = await this.scope.area(tx, ctx, HCM_PERMISSIONS['leave.view']);
      const people = await tx
        .select({ userId: tenantMemberships.userId, displayName: users.displayName })
        .from(tenantMemberships)
        .innerJoin(users, eq(users.id, tenantMemberships.userId))
        .where(and(eq(tenantMemberships.status, 'active'), this.scope.condition(area, tenantMemberships.userId)))
        .orderBy(asc(users.displayName));
      const today = todayIso();
      const balances = await this.compute(tx, people.map((p) => p.userId), jalaliYear ?? toJalali(today).jy, today, policy);
      return balances.map((b, i) => ({ ...b, displayName: people[i]!.displayName }));
    });
  }

  async compute(tx: Tx, userIds: string[], jy: number, today: string, policy: LeavePolicy): Promise<LeaveBalance[]> {
    if (!userIds.length) return [];
    const emp = new Map((await tx.select().from(employments).where(inArray(employments.userId, userIds))).map((e) => [e.userId, e]));
    const joined = new Map(
      (
        await tx
          .select({ userId: tenantMemberships.userId, at: tenantMemberships.joinedAt })
          .from(tenantMemberships)
          .where(inArray(tenantMemberships.userId, userIds))
      ).map((m) => [m.userId, todayIso(m.at)]),
    );
    const taken = await tx
      .select({
        userId: leaveRequests.userId,
        status: leaveRequests.status,
        days: sql<number>`sum(${leaveRequests.effectiveDays})`.mapWith(Number),
      })
      .from(leaveRequests)
      .innerJoin(leaveTypes, and(eq(leaveTypes.tenantId, leaveRequests.tenantId), eq(leaveTypes.id, leaveRequests.typeId)))
      .where(
        and(
          inArray(leaveRequests.userId, userIds),
          eq(leaveRequests.jalaliYear, jy),
          eq(leaveTypes.deductsEntitlement, true),
          inArray(leaveRequests.status, ['approved', 'pending']),
        ),
      )
      .groupBy(leaveRequests.userId, leaveRequests.status);
    const ledger = await tx
      .select({
        userId: leaveLedger.userId,
        carryIn: sql<boolean>`${leaveLedger.kind} = 'carry_in'`,
        days: sql<number>`sum(${leaveLedger.days})`.mapWith(Number),
      })
      .from(leaveLedger)
      .where(and(inArray(leaveLedger.userId, userIds), eq(leaveLedger.jalaliYear, jy)))
      .groupBy(leaveLedger.userId, sql`${leaveLedger.kind} = 'carry_in'`);

    const annual = Number(policy.annualLeaveDays);
    return userIds.map((userId) => {
      const e = emp.get(userId);
      const sum = (status: string) => taken.filter((t) => t.userId === userId && t.status === status).reduce((a, t) => a + t.days, 0);
      const moves = ledger.filter((l) => l.userId === userId);
      const carriedIn = moves.filter((l) => l.carryIn).reduce((a, l) => a + l.days, 0);
      const adjustments = moves.filter((l) => !l.carryIn).reduce((a, l) => a + l.days, 0);
      // no employment profile yet: accrue from the day they joined the company
      const accrued = proratedAccrual(e?.hireDate ?? joined.get(userId) ?? today, jy, annual, today);
      const used = sum('approved');
      return {
        userId,
        jalaliYear: jy,
        hireDate: e?.hireDate ?? null,
        dailyWorkMinutes: e?.dailyWorkMinutes ?? SITE_MINUTES.hq,
        annual,
        accrued,
        used: round2(used),
        pending: round2(sum('pending')),
        carriedIn: round2(carriedIn),
        adjustments: round2(adjustments),
        remaining: round2(accrued + carriedIn + adjustments - used),
      };
    });
  }

  // ── ledger ──────────────────────────────────────────────────────────────

  ledger(ctx: TenantContext, userId: string, jalaliYear?: number) {
    return this.db.tenant(ctx, async (tx) => {
      await this.setup.requireViewOver(tx, ctx, userId);
      return tx
        .select()
        .from(leaveLedger)
        .where(and(eq(leaveLedger.userId, userId), jalaliYear ? eq(leaveLedger.jalaliYear, jalaliYear) : undefined))
        .orderBy(desc(leaveLedger.createdAt));
    });
  }

  addLedgerEntry(ctx: TenantContext, body: LedgerEntryRequest) {
    return this.db.tenant(ctx, async (tx) => {
      // HR staff do not move their own balance
      if (body.userId === ctx.userId) {
        const area = await this.scope.area(tx, ctx, HCM_PERMISSIONS['leave_ledger.manage']);
        if (!area.all) throw ApiError.forbidden('OWN_BALANCE', 'Changing your own leave balance needs tenant-wide hcm.leave_ledger.manage');
      }
      await this.scope.requireOver(tx, ctx, HCM_PERMISSIONS['leave_ledger.manage'], body.userId);
      const [row] = await tx
        .insert(leaveLedger)
        .values({
          tenantId: sql`core.current_tenant()`,
          userId: body.userId,
          jalaliYear: body.jalaliYear,
          kind: body.kind,
          days: body.days,
          note: body.note ?? null,
          createdBy: ctx.userId,
        })
        .returning();
      await this.audit.record(tx, ctx, { action: 'hcm.leave_ledger.add', entityType: 'hcm.leave_ledger', entityId: row!.id, after: row });
      return row!;
    });
  }
}
