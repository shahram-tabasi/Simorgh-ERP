import { Injectable } from '@nestjs/common';
import { CORE_PERMISSIONS, CoreEvents, type ApprovalItem } from '@simorgh/contracts';
import { users, wfDefinitions, wfHistory, wfInstances, wfTasks, type Tx } from '@simorgh/db';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { DbService } from '../db/db.module.js';
import { ApiError } from '../http/api-error.js';
import type { TenantContext } from '../http/context.js';
import { OrgService } from '../org/org.service.js';
import { addGrant, areaCovers, emptyArea } from '../org/scope.js';
import { ScopeService } from '../org/scope.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { ADMIN_ROLE_KEY } from '../rbac/rbac.service.js';
import { conditionsHold, WorkflowBody, type AssigneeRule, type StepDef } from './definitions.js';
import { WorkflowRegistry, type WorkflowOutcome } from './workflow.registry.js';

export interface StartWorkflow {
  key: string;
  docId: string;
  /** The person the document is about; never an approver of it. */
  subjectUserId: string;
  title: string;
  /** Values the definition's conditions read (amount, number of levels, …). */
  data?: Record<string, unknown>;
}

interface InstanceContext {
  data: Record<string, unknown>;
  /** Ids of the steps that run, fixed at start. */
  plan: string[];
}

type Eligible = Map<string, { rule: AssigneeRule['kind'] | 'admin_fallback'; permission: string | null }>;

/**
 * The approval engine (architecture §11) — Kara's leave approval chain made
 * general: definitions are data, each step fans out to every eligible person's
 * kartabl, the first decision wins, and the document's own handler runs in
 * the same transaction as the final decision.
 *
 * Eligibility is resolved when a step opens and again when someone decides,
 * so losing a permission or leaving a unit also takes away the pending ones.
 */
@Injectable()
export class WorkflowEngine {
  constructor(
    private readonly db: DbService,
    private readonly registry: WorkflowRegistry,
    private readonly org: OrgService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Starts an approval flow for a document, inside the caller's transaction.
   * Every step that will run must have someone able to decide it; otherwise
   * the document is refused now rather than stuck later.
   */
  async start(tx: Tx, ctx: TenantContext, input: StartWorkflow): Promise<{ instanceId: string; status: 'running' | 'approved' }> {
    const shipped = this.registry.definition(input.key);
    const def = await this.tenantDefinition(tx, input.key);
    const data = input.data ?? {};
    const steps = def.body.steps.filter((s) => conditionsHold(s.when, data));

    for (const step of steps) {
      if (!(await this.eligible(tx, step, input.subjectUserId, null)).size) {
        throw ApiError.conflict('WORKFLOW_NO_APPROVER', `Nobody can approve step "${step.label.en}" for this person`);
      }
    }

    const context: InstanceContext = { data, plan: steps.map((s) => s.id) };
    const [instance] = await tx
      .insert(wfInstances)
      .values({
        tenantId: sql`core.current_tenant()`,
        definitionId: def.id,
        docType: shipped.docType,
        docId: input.docId,
        subjectUserId: input.subjectUserId,
        title: input.title,
        context: context as unknown as Record<string, unknown>,
        startedBy: ctx.userId,
      })
      .returning();
    await this.history(tx, instance!.id, null, 'start', ctx.userId, null, { key: input.key, version: def.version, plan: context.plan });
    await this.outbox.enqueue(tx, ctx, {
      type: CoreEvents.workflowStarted,
      subject: { type: 'core.workflow', id: instance!.id },
      data: { key: input.key, docType: shipped.docType, docId: input.docId, subjectUserId: input.subjectUserId, plan: context.plan },
    });

    if (!steps.length) {
      await this.finish(tx, ctx, instance!, 'approved', null);
      return { instanceId: instance!.id, status: 'approved' };
    }
    await this.activate(tx, ctx, instance!, steps[0]!, 1);
    return { instanceId: instance!.id, status: 'running' };
  }

  /** Approve or reject one open task of the caller. */
  decide(ctx: TenantContext, taskId: string, decision: 'approve' | 'reject', comment: string | null) {
    return this.db.tenant(ctx, async (tx) => {
      // lock order is always instance, then its tasks (as in cancel), so concurrent decisions cannot deadlock
      const [found] = await tx.select({ instanceId: wfTasks.instanceId }).from(wfTasks).where(eq(wfTasks.id, taskId));
      if (!found) throw ApiError.notFound('TASK_NOT_FOUND', 'No such task in your kartabl');
      const [instance] = await tx.select().from(wfInstances).where(eq(wfInstances.id, found.instanceId)).for('update');
      const [task] = await tx.select().from(wfTasks).where(eq(wfTasks.id, taskId)).for('update');
      if (!task || task.assigneeUserId !== ctx.userId) throw ApiError.notFound('TASK_NOT_FOUND', 'No such task in your kartabl');
      if (task.status !== 'open') throw ApiError.conflict('TASK_CLOSED', 'This task has already been decided or withdrawn');
      if (!instance || instance.status !== 'running' || instance.currentStep !== task.stepId) {
        throw ApiError.conflict('TASK_CLOSED', 'This workflow has moved on');
      }
      const body = await this.bodyOf(tx, instance.definitionId);
      const step = body.steps.find((s) => s.id === task.stepId)!;
      if (!(await this.eligible(tx, step, instance.subjectUserId!, instance.id)).has(ctx.userId)) {
        throw ApiError.forbidden('NOT_ELIGIBLE', 'You can no longer decide this step');
      }

      const status = decision === 'approve' ? 'approved' : 'rejected';
      await tx.update(wfTasks).set({ status, decidedAt: new Date(), decidedBy: ctx.userId, comment }).where(eq(wfTasks.id, task.id));
      // the step is decided: withdraw it from everyone else's kartabl
      await tx
        .update(wfTasks)
        .set({ status: 'cancelled' })
        .where(and(eq(wfTasks.instanceId, instance.id), eq(wfTasks.stepId, task.stepId), eq(wfTasks.status, 'open'), ne(wfTasks.id, task.id)));
      await this.history(tx, instance.id, task.stepId, decision, ctx.userId, comment, null);
      await this.audit.record(tx, ctx, {
        action: `core.workflow.${decision}`,
        entityType: instance.docType,
        entityId: instance.docId,
        after: { instanceId: instance.id, stepId: task.stepId, comment },
      });

      if (decision === 'reject') {
        await this.finish(tx, ctx, instance, 'rejected', comment);
      } else {
        const plan = (instance.context as unknown as InstanceContext).plan;
        const nextId = plan[plan.indexOf(task.stepId) + 1];
        if (nextId) await this.activate(tx, ctx, instance, body.steps.find((s) => s.id === nextId)!, task.stepNo + 1);
        else await this.finish(tx, ctx, instance, 'approved', comment);
      }
      return this.viewIn(tx, instance.id);
    });
  }

  /** Withdraws a running flow (the requester cancelled the document), inside the caller's transaction. */
  async cancel(tx: Tx, ctx: TenantContext, instanceId: string, comment: string | null = null): Promise<void> {
    const [instance] = await tx.select().from(wfInstances).where(eq(wfInstances.id, instanceId)).for('update');
    if (!instance) throw ApiError.notFound('WORKFLOW_NOT_FOUND', 'Workflow not found');
    if (instance.status !== 'running') throw ApiError.conflict('WORKFLOW_FINISHED', 'This workflow has already finished');
    await tx.update(wfTasks).set({ status: 'cancelled' }).where(and(eq(wfTasks.instanceId, instanceId), eq(wfTasks.status, 'open')));
    await this.finish(tx, ctx, instance, 'cancelled', comment);
  }

  /** Open approvals in the caller's kartabl. */
  async myApprovals(tx: Tx, userId: string): Promise<ApprovalItem[]> {
    const rows = await tx
      .select({ t: wfTasks, i: wfInstances, definition: wfDefinitions.definition, subjectName: users.displayName })
      .from(wfTasks)
      .innerJoin(wfInstances, and(eq(wfInstances.tenantId, wfTasks.tenantId), eq(wfInstances.id, wfTasks.instanceId)))
      .innerJoin(wfDefinitions, eq(wfDefinitions.id, wfInstances.definitionId))
      .leftJoin(users, eq(users.id, wfInstances.subjectUserId))
      .where(and(eq(wfTasks.assigneeUserId, userId), eq(wfTasks.status, 'open')))
      .orderBy(asc(wfTasks.createdAt));
    return rows.map(({ t, i, definition, subjectName }) => ({
      taskId: t.id,
      instanceId: i.id,
      docType: i.docType,
      docId: i.docId,
      title: i.title,
      stepId: t.stepId,
      stepLabel: (definition as WorkflowBody).steps.find((s) => s.id === t.stepId)?.label.fa ?? null,
      subjectUserId: i.subjectUserId,
      subjectName,
      createdAt: t.createdAt.toISOString(),
    }));
  }

  /**
   * A flow with its tasks and history. Visible to the people in it (subject,
   * starter, anyone it was assigned to) and to holders of core.workflow.view
   * over the subject.
   */
  view(ctx: TenantContext, instanceId: string) {
    return this.db.tenant(ctx, async (tx) => {
      const v = await this.viewIn(tx, instanceId);
      const involved =
        v.subjectUserId === ctx.userId || v.startedBy === ctx.userId || v.tasks.some((t) => t.assigneeUserId === ctx.userId);
      if (!involved) {
        const area = await this.scope.area(tx, ctx, CORE_PERMISSIONS['workflow.view']);
        if (!v.subjectUserId || !(await this.scope.covers(tx, area, v.subjectUserId))) {
          throw ApiError.notFound('WORKFLOW_NOT_FOUND', 'Workflow not found');
        }
      }
      return v;
    });
  }

  async viewIn(tx: Tx, instanceId: string) {
    const [instance] = await tx.select().from(wfInstances).where(eq(wfInstances.id, instanceId));
    if (!instance) throw ApiError.notFound('WORKFLOW_NOT_FOUND', 'Workflow not found');
    const tasks = await tx.select().from(wfTasks).where(eq(wfTasks.instanceId, instanceId)).orderBy(asc(wfTasks.stepNo), asc(wfTasks.createdAt));
    const history = await tx.select().from(wfHistory).where(eq(wfHistory.instanceId, instanceId)).orderBy(asc(wfHistory.at));
    const { context, ...rest } = instance;
    return { ...rest, plan: (context as unknown as InstanceContext).plan, tasks, history };
  }

  /** The latest flow of a document, if any (for the document's own detail page). */
  async latestFor(tx: Tx, docType: string, docId: string) {
    const [row] = await tx
      .select({ id: wfInstances.id })
      .from(wfInstances)
      .where(and(eq(wfInstances.docType, docType), eq(wfInstances.docId, docId)))
      .orderBy(desc(wfInstances.startedAt))
      .limit(1);
    return row ? this.viewIn(tx, row.id) : null;
  }

  // ── internals ───────────────────────────────────────────────────────────

  private async activate(tx: Tx, ctx: TenantContext, instance: typeof wfInstances.$inferSelect, step: StepDef, stepNo: number) {
    const eligible = await this.eligible(tx, step, instance.subjectUserId!, instance.id);
    if (!eligible.size) {
      // possible when people left or lost access after the flow started
      throw ApiError.conflict('WORKFLOW_NO_APPROVER', `Nobody can approve step "${step.label.en}" any more`);
    }
    await tx.update(wfInstances).set({ currentStep: step.id }).where(eq(wfInstances.id, instance.id));
    await tx.insert(wfTasks).values(
      [...eligible].map(([userId, why]) => ({
        tenantId: sql`core.current_tenant()`,
        instanceId: instance.id,
        stepId: step.id,
        stepNo,
        assigneeUserId: userId,
        assigneeRule: why.rule,
        assigneePermission: why.permission,
      })),
    );
    const assignees = [...eligible.keys()];
    await this.history(tx, instance.id, step.id, 'activate', ctx.userId, null, { assignees });
    await this.outbox.enqueue(tx, ctx, {
      type: CoreEvents.approvalRequested,
      subject: { type: 'core.workflow', id: instance.id },
      data: { docType: instance.docType, docId: instance.docId, title: instance.title, stepId: step.id, assigneeUserIds: assignees },
    });
  }

  private async finish(
    tx: Tx,
    ctx: TenantContext,
    instance: typeof wfInstances.$inferSelect,
    outcome: WorkflowOutcome,
    comment: string | null,
  ): Promise<void> {
    await tx
      .update(wfInstances)
      .set({ status: outcome, currentStep: null, finishedAt: new Date(), outcomeComment: comment })
      .where(eq(wfInstances.id, instance.id));
    await this.history(tx, instance.id, null, outcome === 'cancelled' ? 'cancel' : 'complete', ctx.userId, comment, { outcome });
    await this.outbox.enqueue(tx, ctx, {
      type: CoreEvents.workflowCompleted,
      subject: { type: 'core.workflow', id: instance.id },
      data: { docType: instance.docType, docId: instance.docId, outcome },
    });
    const handler = this.registry.handler(instance.docType);
    if (handler) {
      await handler(tx, ctx, { instanceId: instance.id, docType: instance.docType, docId: instance.docId, outcome, actorUserId: ctx.userId, comment });
    }
  }

  /**
   * Who may decide `step` for `subjectUserId`. The subject never may, nor
   * whoever decided a step listed in `sod`. When the rules name nobody, the
   * tenant's administrators are the fallback, so a missing assignment shows
   * up in someone's kartabl instead of blocking the document.
   */
  private async eligible(tx: Tx, step: StepDef, subjectUserId: string, instanceId: string | null): Promise<Eligible> {
    const out: Eligible = new Map();
    const add = (userId: string, rule: AssigneeRule['kind'] | 'admin_fallback', permission: string | null = null) => {
      if (!out.has(userId)) out.set(userId, { rule, permission });
    };

    for (const rule of step.assignees) {
      switch (rule.kind) {
        case 'permission':
          for (const userId of await this.permissionHolders(tx, rule.key, subjectUserId)) add(userId, 'permission', rule.key);
          break;
        case 'org_unit_manager':
          for (const userId of await this.org.managersOf(tx, subjectUserId)) add(userId, 'org_unit_manager');
          break;
        case 'user':
          add(rule.userId, 'user');
          break;
        case 'role':
          for (const userId of await this.roleHolders(tx, rule.key)) add(userId, 'role');
          break;
      }
    }

    const excluded = new Set([subjectUserId]);
    if (instanceId && step.sod?.length) {
      const earlier = await tx
        .select({ by: wfTasks.decidedBy })
        .from(wfTasks)
        .where(and(eq(wfTasks.instanceId, instanceId), inArray(wfTasks.stepId, step.sod), eq(wfTasks.status, 'approved')));
      for (const e of earlier) if (e.by) excluded.add(e.by);
    }
    const active = await this.activeMembers(tx, [...out.keys()]);
    for (const userId of [...out.keys()]) if (excluded.has(userId) || !active.has(userId)) out.delete(userId);

    if (!out.size) {
      for (const userId of await this.roleHolders(tx, ADMIN_ROLE_KEY)) {
        if (!excluded.has(userId)) add(userId, 'admin_fallback');
      }
    }
    return out;
  }

  /** Members holding `key` through a role whose scope and context reach `subjectUserId`. */
  private async permissionHolders(tx: Tx, key: string, subjectUserId: string): Promise<string[]> {
    // The administrator role holds everything, but approvals are routed to the
    // people given the permission on purpose; admins are only the fallback.
    const grants = await tx.execute<{ user_id: string; scope: string; context_type: string; context_id: string | null }>(sql`
      select ur.user_id, rp.scope, ur.context_type, ur.context_id
        from core.user_roles ur
        join core.roles r on r.tenant_id = ur.tenant_id and r.id = ur.role_id
        join core.role_permissions rp on rp.tenant_id = ur.tenant_id and rp.role_id = ur.role_id
       where rp.permission_key = ${key}
         and not (r.is_system and r.key = ${ADMIN_ROLE_KEY})
         and (ur.valid_until is null or ur.valid_until >= current_date)`);
    if (!grants.rows.length) return [];

    const holders = [...new Set(grants.rows.map((g) => g.user_id))];
    const units = await this.scope.unitsOf(tx, [...holders, subjectUserId]);
    const contextUnits = await this.scope.unitsById(
      tx,
      grants.rows.filter((g) => g.context_type === 'org_unit' && g.context_id).map((g) => g.context_id!),
    );
    const subjectUnits = units.get(subjectUserId)!;
    return holders.filter((holder) => {
      const area = emptyArea();
      for (const g of grants.rows.filter((r) => r.user_id === holder)) {
        addGrant(area, { scope: g.scope as never, contextType: g.context_type as never, contextId: g.context_id }, holder, units.get(holder)!, contextUnits);
      }
      return areaCovers(area, subjectUserId, subjectUnits);
    });
  }

  private async roleHolders(tx: Tx, roleKey: string): Promise<string[]> {
    const rows = await tx.execute<{ user_id: string }>(sql`
      select distinct ur.user_id
        from core.user_roles ur
        join core.roles r on r.tenant_id = ur.tenant_id and r.id = ur.role_id
       where r.key = ${roleKey} and (ur.valid_until is null or ur.valid_until >= current_date)`);
    return rows.rows.map((r) => r.user_id);
  }

  private async activeMembers(tx: Tx, userIds: string[]): Promise<Set<string>> {
    if (!userIds.length) return new Set();
    const rows = await tx.execute<{ user_id: string }>(sql`
      select m.user_id from core.tenant_memberships m join core.users u on u.id = m.user_id
       where m.user_id = any(${sql.param(userIds)}::uuid[]) and m.status = 'active' and u.is_active`);
    return new Set(rows.rows.map((r) => r.user_id));
  }

  /**
   * The tenant's definition for `key`: its own edited version if it has one,
   * otherwise its copy of the shipped one (made on first use, and again when
   * a release ships a new version).
   */
  private async tenantDefinition(tx: Tx, key: string): Promise<{ id: string; version: number; body: WorkflowBody }> {
    const [custom] = await tx
      .select()
      .from(wfDefinitions)
      .where(and(eq(wfDefinitions.key, key), eq(wfDefinitions.source, 'tenant'), eq(wfDefinitions.isActive, true)))
      .orderBy(desc(wfDefinitions.version))
      .limit(1);
    if (custom) return { id: custom.id, version: custom.version, body: WorkflowBody.parse(custom.definition) };

    const shipped = this.registry.definition(key);
    const body: WorkflowBody = { steps: shipped.steps };
    await tx
      .insert(wfDefinitions)
      .values({ tenantId: sql`core.current_tenant()`, key, version: shipped.version, docType: shipped.docType, definition: body, source: 'shipped' })
      .onConflictDoNothing();
    const [row] = await tx
      .select({ id: wfDefinitions.id })
      .from(wfDefinitions)
      .where(and(eq(wfDefinitions.key, key), eq(wfDefinitions.version, shipped.version), sql`${wfDefinitions.tenantId} = core.current_tenant()`));
    return { id: row!.id, version: shipped.version, body };
  }

  private async bodyOf(tx: Tx, definitionId: string): Promise<WorkflowBody> {
    const [row] = await tx.select({ definition: wfDefinitions.definition }).from(wfDefinitions).where(eq(wfDefinitions.id, definitionId));
    return WorkflowBody.parse(row!.definition);
  }

  private async history(
    tx: Tx,
    instanceId: string,
    stepId: string | null,
    action: (typeof wfHistory.$inferInsert)['action'],
    actorUserId: string,
    comment: string | null,
    data: unknown,
  ) {
    await tx.insert(wfHistory).values({ tenantId: sql`core.current_tenant()`, instanceId, stepId, action, actorUserId, comment, data });
  }
}
