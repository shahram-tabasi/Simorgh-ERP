import { Injectable } from '@nestjs/common';
import {
  HCM_PERMISSIONS,
  type EmploymentRequest,
  type LeavePolicyRequest,
  type LeaveTypeRequest,
  type UpdateLeaveTypeRequest,
} from '@simorgh/contracts';
import { employments, leavePolicies, leaveTypes, tenantMemberships, workSchedules, type Tx } from '@simorgh/db';
import { asc, eq, sql } from 'drizzle-orm';
import { AuditService } from '../../../kernel/audit/audit.service.js';
import { DbService } from '../../../kernel/db/db.module.js';
import { ApiError } from '../../../kernel/http/api-error.js';
import type { TenantContext } from '../../../kernel/http/context.js';
import { pgError } from '../../../kernel/http/pg-error.js';
import { ScopeService } from '../../../kernel/org/scope.service.js';
import { DEFAULT_LEAVE_TYPES } from '../domain/default-leave-types.js';
import { SITE_MINUTES } from '../domain/leave-rules.js';

export type LeaveTypeRow = typeof leaveTypes.$inferSelect;
export type LeavePolicy = typeof leavePolicies.$inferSelect;

/**
 * HCM configuration: the leave policy, the leave-type catalogue and each
 * person's employment profile. A tenant gets Kara's defaults the first time
 * HCM is used, so tenants made before HCM existed need no back-fill.
 */
@Injectable()
export class HcmSetupService {
  constructor(
    private readonly db: DbService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
  ) {}

  /** Seeds the policy and the default leave types once per tenant; returns the policy. */
  async ensureSeeded(tx: Tx): Promise<LeavePolicy> {
    const [existing] = await tx.select().from(leavePolicies);
    if (existing) return existing;
    const [policy] = await tx
      .insert(leavePolicies)
      .values({ tenantId: sql`core.current_tenant()` })
      .onConflictDoNothing()
      .returning();
    if (!policy) return (await tx.select().from(leavePolicies))[0]!; // a concurrent request seeded it
    await tx
      .insert(leaveTypes)
      .values(DEFAULT_LEAVE_TYPES.map((t) => ({ ...t, tenantId: sql`core.current_tenant()`, isSystem: true })))
      .onConflictDoNothing();
    return policy;
  }

  // ── policy ──────────────────────────────────────────────────────────────

  policy(ctx: TenantContext) {
    return this.db.tenant(ctx, (tx) => this.ensureSeeded(tx));
  }

  setPolicy(ctx: TenantContext, body: LeavePolicyRequest) {
    return this.db.tenant(ctx, async (tx) => {
      const before = await this.ensureSeeded(tx);
      const [after] = await tx
        .update(leavePolicies)
        .set({ annualLeaveDays: body.annualLeaveDays, maxNegativeDays: body.maxNegativeDays, updatedAt: new Date() })
        .returning();
      await this.audit.record(tx, ctx, { action: 'hcm.leave_policy.update', entityType: 'hcm.leave_policy', before, after });
      return after!;
    });
  }

  // ── leave types ─────────────────────────────────────────────────────────

  types(ctx: TenantContext): Promise<LeaveTypeRow[]> {
    return this.db.tenant(ctx, async (tx) => {
      await this.ensureSeeded(tx);
      return tx.select().from(leaveTypes).orderBy(asc(leaveTypes.sortOrder), asc(leaveTypes.name));
    });
  }

  createType(ctx: TenantContext, body: LeaveTypeRequest): Promise<LeaveTypeRow> {
    return this.db.tenant(ctx, async (tx) => {
      await this.ensureSeeded(tx);
      const [row] = await tx
        .insert(leaveTypes)
        .values({ ...body, description: body.description ?? null, tenantId: sql`core.current_tenant()` })
        .returning()
        .catch((err: unknown) => {
          if (pgError(err)?.code === '23505') throw ApiError.conflict('LEAVE_TYPE_CODE_TAKEN', 'Another leave type has this code');
          throw err;
        });
      await this.audit.record(tx, ctx, { action: 'hcm.leave_type.create', entityType: 'hcm.leave_type', entityId: row!.id, after: row });
      return row!;
    });
  }

  /** Types are never deleted (requests refer to them); deactivate instead. */
  updateType(ctx: TenantContext, id: string, body: UpdateLeaveTypeRequest): Promise<LeaveTypeRow> {
    return this.db.tenant(ctx, async (tx) => {
      const [before] = await tx.select().from(leaveTypes).where(eq(leaveTypes.id, id));
      if (!before) throw ApiError.notFound('LEAVE_TYPE_NOT_FOUND', 'Leave type not found');
      const [after] = await tx.update(leaveTypes).set(body).where(eq(leaveTypes.id, id)).returning();
      await this.audit.record(tx, ctx, { action: 'hcm.leave_type.update', entityType: 'hcm.leave_type', entityId: id, before, after });
      return after!;
    });
  }

  // ── employment profile ──────────────────────────────────────────────────

  async employmentOf(tx: Tx, userId: string) {
    const [row] = await tx.select().from(employments).where(eq(employments.userId, userId));
    return row ?? null;
  }

  employment(ctx: TenantContext, userId: string) {
    return this.db.tenant(ctx, async (tx) => {
      await this.requireViewOver(tx, ctx, userId);
      return this.employmentOf(tx, userId);
    });
  }

  setEmployment(ctx: TenantContext, userId: string, body: EmploymentRequest) {
    return this.db.tenant(ctx, async (tx) => {
      // nobody sets their own hire date: it drives their entitlement
      if (userId === ctx.userId && !(await this.scope.covers(tx, await this.scope.area(tx, ctx, HCM_PERMISSIONS['employment.manage']), userId))) {
        throw ApiError.forbidden('OUT_OF_SCOPE', 'hcm.employment.manage is needed, also for your own profile');
      }
      await this.scope.requireOver(tx, ctx, HCM_PERMISSIONS['employment.manage'], userId);
      const [member] = await tx.select({ userId: tenantMemberships.userId }).from(tenantMemberships).where(eq(tenantMemberships.userId, userId));
      if (!member) throw ApiError.notFound('MEMBER_NOT_FOUND', 'Member not found');
      if (body.workScheduleId) {
        const [s] = await tx.select({ id: workSchedules.id }).from(workSchedules).where(eq(workSchedules.id, body.workScheduleId));
        if (!s) throw ApiError.badRequest('SCHEDULE_NOT_FOUND', 'Work schedule not found');
      }
      const before = await this.employmentOf(tx, userId);
      const values = {
        hireDate: body.hireDate,
        site: body.site,
        dailyWorkMinutes: body.dailyWorkMinutes ?? SITE_MINUTES[body.site],
        workScheduleId: body.workScheduleId ?? null,
        updatedAt: new Date(),
      };
      const [after] = await tx
        .insert(employments)
        .values({ tenantId: sql`core.current_tenant()`, userId, ...values })
        .onConflictDoUpdate({ target: [employments.tenantId, employments.userId], set: values })
        .returning();
      await this.audit.record(tx, ctx, { action: 'hcm.employment.set', entityType: 'hcm.employment', entityId: userId, before, after });
      return after!;
    });
  }

  /** Your own HCM data, or someone's reached by hcm.leave.view or hcm.employment.manage. */
  async requireViewOver(tx: Tx, ctx: TenantContext, userId: string): Promise<void> {
    if (userId === ctx.userId) return;
    for (const key of [HCM_PERMISSIONS['leave.view'], HCM_PERMISSIONS['employment.manage']]) {
      if (await this.scope.covers(tx, await this.scope.area(tx, ctx, key), userId)) return;
    }
    throw ApiError.forbidden('OUT_OF_SCOPE', 'You cannot see this person’s HR data');
  }
}

