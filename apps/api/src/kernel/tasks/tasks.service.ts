import { Injectable } from '@nestjs/common';
import { CORE_PERMISSIONS, CoreEvents, type CreateTaskRequest } from '@simorgh/contracts';
import { taskAssignees, tasks, tenantMemberships, users, type TaskStatus, type Tx } from '@simorgh/db';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { DbService } from '../db/db.module.js';
import { ApiError } from '../http/api-error.js';
import type { TenantContext } from '../http/context.js';
import { OrgService } from '../org/org.service.js';
import { ScopeService } from '../org/scope.service.js';
import { OutboxService } from '../outbox/outbox.service.js';

export interface TaskView {
  id: string;
  title: string;
  body: string | null;
  code: string | null;
  priority: string;
  fromDate: string | null;
  dueDate: string | null;
  createdBy: string | null;
  orgUnitId: string | null;
  parentId: string | null;
  createdAt: string;
  assignees: {
    userId: string;
    displayName: string;
    status: TaskStatus;
    delegatedFrom: string | null;
    acknowledgedAt: string | null;
  }[];
}

/**
 * Work tasks — «میز کار» (Kara work_tasks). Managers send tasks to people or
 * to a whole unit; each assignee reports their own progress, confirms
 * receipt, and may hand their share on to a colleague (واگذاری) without any
 * permission — the only way a regular member moves work.
 */
@Injectable()
export class TasksService {
  constructor(
    private readonly db: DbService,
    private readonly org: OrgService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** `inbox`: tasks assigned to me; `sent`: tasks I created. */
  list(ctx: TenantContext, box: 'inbox' | 'sent'): Promise<TaskView[]> {
    return this.db.tenant(ctx, async (tx) => {
      const ids =
        box === 'sent'
          ? (await tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.createdBy, ctx.userId)).orderBy(desc(tasks.createdAt))).map((r) => r.id)
          : (
              await tx
                .select({ id: taskAssignees.taskId })
                .from(taskAssignees)
                .innerJoin(tasks, and(eq(tasks.tenantId, taskAssignees.tenantId), eq(tasks.id, taskAssignees.taskId)))
                .where(eq(taskAssignees.userId, ctx.userId))
                .orderBy(desc(tasks.createdAt))
            ).map((r) => r.id);
      return this.views(tx, ids);
    });
  }

  create(ctx: TenantContext, body: CreateTaskRequest): Promise<TaskView> {
    return this.db.tenant(ctx, async (tx) => {
      const to = await this.org.resolveRecipients(tx, body.to);
      const area = await this.scope.area(tx, ctx, CORE_PERMISSIONS['task.assign']);
      for (const userId of to) {
        if (!(await this.scope.covers(tx, area, userId))) {
          throw ApiError.forbidden('OUT_OF_SCOPE', 'You cannot send tasks to some of these people');
        }
      }
      if (body.parentId) await this.load(tx, body.parentId);
      const [task] = await tx
        .insert(tasks)
        .values({
          tenantId: sql`core.current_tenant()`,
          title: body.title,
          body: body.body ?? null,
          code: body.code ?? null,
          priority: body.priority,
          fromDate: body.fromDate ?? null,
          dueDate: body.dueDate ?? null,
          createdBy: ctx.userId,
          orgUnitId: body.to.orgUnitId ?? null,
          parentId: body.parentId ?? null,
        })
        .returning();
      await tx
        .insert(taskAssignees)
        .values(to.map((userId) => ({ tenantId: sql`core.current_tenant()`, taskId: task!.id, userId })));
      const view = (await this.views(tx, [task!.id]))[0]!;
      await this.audit.record(tx, ctx, { action: 'core.task.create', entityType: 'core.task', entityId: task!.id, after: view });
      await this.outbox.enqueue(tx, ctx, {
        type: CoreEvents.taskAssigned,
        subject: { type: 'core.task', id: task!.id, no: task!.code },
        data: { title: task!.title, priority: task!.priority, dueDate: task!.dueDate, assigneeUserIds: to },
      });
      return view;
    });
  }

  setStatus(ctx: TenantContext, taskId: string, status: TaskStatus): Promise<TaskView> {
    return this.mine(ctx, taskId, 'core.task.set_status', (tx, a) =>
      tx.update(taskAssignees).set({ status, updatedAt: new Date() }).where(eq(taskAssignees.id, a.id)),
    );
  }

  acknowledge(ctx: TenantContext, taskId: string): Promise<TaskView> {
    return this.mine(ctx, taskId, 'core.task.acknowledge', (tx, a) =>
      tx
        .update(taskAssignees)
        .set({ acknowledgedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(taskAssignees.id, a.id), isNull(taskAssignees.acknowledgedAt))),
    );
  }

  /** Hands my share of a task to a colleague; they start it afresh and see who passed it on. */
  delegate(ctx: TenantContext, taskId: string, toUserId: string): Promise<TaskView> {
    if (toUserId === ctx.userId) throw ApiError.badRequest('DELEGATE_TO_SELF', 'You cannot hand a task to yourself');
    return this.mine(ctx, taskId, 'core.task.delegate', async (tx, a) => {
      await this.org.resolveRecipients(tx, { userIds: [toUserId] });
      const [already] = await tx
        .select({ id: taskAssignees.id })
        .from(taskAssignees)
        .where(and(eq(taskAssignees.taskId, taskId), eq(taskAssignees.userId, toUserId)));
      if (already) await tx.delete(taskAssignees).where(eq(taskAssignees.id, a.id));
      else {
        await tx
          .update(taskAssignees)
          .set({ userId: toUserId, delegatedFrom: ctx.userId, status: 'open', acknowledgedAt: null, updatedAt: new Date() })
          .where(eq(taskAssignees.id, a.id));
      }
      await this.outbox.enqueue(tx, ctx, {
        type: CoreEvents.taskAssigned,
        subject: { type: 'core.task', id: taskId },
        data: { assigneeUserIds: [toUserId], delegatedFrom: ctx.userId },
      });
    });
  }

  /** Only the task's creator deletes it. */
  remove(ctx: TenantContext, taskId: string): Promise<void> {
    return this.db.tenant(ctx, async (tx) => {
      const task = await this.load(tx, taskId);
      if (task.createdBy !== ctx.userId) throw ApiError.forbidden('NOT_TASK_CREATOR', 'Only whoever created the task can delete it');
      await tx.delete(tasks).where(eq(tasks.id, taskId));
      await this.audit.record(tx, ctx, { action: 'core.task.delete', entityType: 'core.task', entityId: taskId, before: task });
    });
  }

  /** Runs `fn` on the caller's own assignment of `taskId`, then returns the task. */
  private mine(
    ctx: TenantContext,
    taskId: string,
    action: string,
    fn: (tx: Tx, a: typeof taskAssignees.$inferSelect) => Promise<unknown>,
  ): Promise<TaskView> {
    return this.db.tenant(ctx, async (tx) => {
      const [a] = await tx
        .select()
        .from(taskAssignees)
        .where(and(eq(taskAssignees.taskId, taskId), eq(taskAssignees.userId, ctx.userId)))
        .for('update');
      if (!a) throw ApiError.notFound('TASK_NOT_FOUND', 'This task is not assigned to you');
      await fn(tx, a);
      await this.audit.record(tx, ctx, { action, entityType: 'core.task', entityId: taskId, before: a });
      const [view] = await this.views(tx, [taskId]);
      return view!;
    });
  }

  private async load(tx: Tx, id: string) {
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, id));
    if (!task) throw ApiError.notFound('TASK_NOT_FOUND', 'Task not found');
    return task;
  }

  private async views(tx: Tx, ids: string[]): Promise<TaskView[]> {
    if (!ids.length) return [];
    const rows = await tx.select().from(tasks).where(inArray(tasks.id, ids));
    const assignees = await tx
      .select({ a: taskAssignees, displayName: users.displayName })
      .from(taskAssignees)
      .innerJoin(tenantMemberships, and(eq(tenantMemberships.tenantId, taskAssignees.tenantId), eq(tenantMemberships.userId, taskAssignees.userId)))
      .innerJoin(users, eq(users.id, taskAssignees.userId))
      .where(inArray(taskAssignees.taskId, ids));
    const byId = new Map(rows.map((t) => [t.id, t]));
    return ids
      .filter((id) => byId.has(id))
      .map((id) => {
        const t = byId.get(id)!;
        return {
          id: t.id,
          title: t.title,
          body: t.body,
          code: t.code,
          priority: t.priority,
          fromDate: t.fromDate,
          dueDate: t.dueDate,
          createdBy: t.createdBy,
          orgUnitId: t.orgUnitId,
          parentId: t.parentId,
          createdAt: t.createdAt.toISOString(),
          assignees: assignees
            .filter((r) => r.a.taskId === id)
            .map((r) => ({
              userId: r.a.userId,
              displayName: r.displayName,
              status: r.a.status,
              delegatedFrom: r.a.delegatedFrom,
              acknowledgedAt: r.a.acknowledgedAt?.toISOString() ?? null,
            })),
        };
      });
  }
}
