import { Injectable } from '@nestjs/common';
import {
  CORE_PERMISSIONS,
  CoreEvents,
  type CreateInboxItemRequest,
  type SendMessageRequest,
  type UpdateInboxItemRequest,
} from '@simorgh/contracts';
import { inboxItems, type InboxStatus, type Tx } from '@simorgh/db';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { DbService } from '../db/db.module.js';
import { ApiError } from '../http/api-error.js';
import type { TenantContext } from '../http/context.js';
import { OrgService } from '../org/org.service.js';
import { ScopeService } from '../org/scope.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { WorkflowEngine } from '../workflow/workflow.engine.js';

type Item = typeof inboxItems.$inferSelect;

/**
 * The kartabl (Kara kartabl_items). Accountability, as in Kara:
 *  - an item's author may edit and delete it;
 *  - the person whose kartabl it is may NOT edit or delete what someone else
 *    put there — even a CEO — only report progress through its status;
 *  - core.inbox.manage over the owner lets a manager do both on others' kartabls.
 */
@Injectable()
export class InboxService {
  constructor(
    private readonly db: DbService,
    private readonly scope: ScopeService,
    private readonly org: OrgService,
    private readonly workflow: WorkflowEngine,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** A kartabl: its items, and — for your own — the approvals waiting for you. */
  list(ctx: TenantContext, ownerUserId = ctx.userId, includeArchived = false) {
    return this.db.tenant(ctx, async (tx) => {
      await this.scope.requireOver(tx, ctx, CORE_PERMISSIONS['inbox.manage'], ownerUserId);
      const items = await tx
        .select()
        .from(inboxItems)
        .where(and(eq(inboxItems.ownerUserId, ownerUserId), includeArchived ? undefined : ne(inboxItems.status, 'archived')))
        .orderBy(desc(inboxItems.createdAt));
      const approvals = ownerUserId === ctx.userId ? await this.workflow.myApprovals(tx, ctx.userId) : [];
      return { items, approvals };
    });
  }

  create(ctx: TenantContext, body: CreateInboxItemRequest): Promise<Item> {
    const owner = body.ownerUserId ?? ctx.userId;
    return this.db.tenant(ctx, async (tx) => {
      if (owner !== ctx.userId) await this.requireAssignOver(tx, ctx, [owner]);
      const [item] = await tx
        .insert(inboxItems)
        .values({
          tenantId: sql`core.current_tenant()`,
          ownerUserId: owner,
          kind: body.kind,
          title: body.title,
          body: body.body ?? null,
          folder: body.folder ?? null,
          remindAt: body.remindAt ? new Date(body.remindAt) : null,
          createdBy: ctx.userId,
        })
        .returning();
      await this.audit.record(tx, ctx, { action: 'core.inbox_item.create', entityType: 'core.inbox_item', entityId: item!.id, after: item });
      if (owner !== ctx.userId) {
        await this.outbox.enqueue(tx, ctx, {
          type: CoreEvents.inboxItemCreated,
          subject: { type: 'core.inbox_item', id: item!.id },
          data: { ownerUserIds: [owner], kind: item!.kind, title: item!.title },
        });
      }
      return item!;
    });
  }

  update(ctx: TenantContext, id: string, body: UpdateInboxItemRequest): Promise<Item> {
    return this.db.tenant(ctx, async (tx) => {
      const before = await this.load(tx, id);
      await this.requireEdit(tx, ctx, before);
      const [after] = await tx
        .update(inboxItems)
        .set({
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.body !== undefined ? { body: body.body } : {}),
          ...(body.remindAt !== undefined ? { remindAt: body.remindAt ? new Date(body.remindAt) : null } : {}),
          updatedAt: new Date(),
        })
        .where(eq(inboxItems.id, id))
        .returning();
      await this.audit.record(tx, ctx, { action: 'core.inbox_item.update', entityType: 'core.inbox_item', entityId: id, before, after });
      return after!;
    });
  }

  setStatus(ctx: TenantContext, id: string, status: InboxStatus): Promise<Item> {
    return this.db.tenant(ctx, async (tx) => {
      const before = await this.load(tx, id);
      if (before.ownerUserId !== ctx.userId && before.createdBy !== ctx.userId) {
        await this.scope.requireOver(tx, ctx, CORE_PERMISSIONS['inbox.manage'], before.ownerUserId);
      }
      const [after] = await tx.update(inboxItems).set({ status, updatedAt: new Date() }).where(eq(inboxItems.id, id)).returning();
      await this.audit.record(tx, ctx, { action: 'core.inbox_item.set_status', entityType: 'core.inbox_item', entityId: id, before: { status: before.status }, after: { status } });
      return after!;
    });
  }

  remove(ctx: TenantContext, id: string): Promise<void> {
    return this.db.tenant(ctx, async (tx) => {
      const before = await this.load(tx, id);
      await this.requireEdit(tx, ctx, before);
      await tx.delete(inboxItems).where(eq(inboxItems.id, id));
      await this.audit.record(tx, ctx, { action: 'core.inbox_item.delete', entityType: 'core.inbox_item', entityId: id, before });
    });
  }

  /** A plain message (پیام) to a unit or to chosen people; it lands in each kartabl. */
  send(ctx: TenantContext, body: SendMessageRequest): Promise<{ delivered: number }> {
    return this.db.tenant(ctx, async (tx) => {
      const to = (await this.org.resolveRecipients(tx, body.to)).filter((id) => id !== ctx.userId);
      if (!to.length) throw ApiError.badRequest('NO_RECIPIENTS', 'Nobody to send this to');
      await this.requireAssignOver(tx, ctx, to);
      const rows = await tx
        .insert(inboxItems)
        .values(
          to.map((owner) => ({
            tenantId: sql`core.current_tenant()`,
            ownerUserId: owner,
            kind: 'message' as const,
            title: body.title,
            body: body.body ?? null,
            createdBy: ctx.userId,
          })),
        )
        .returning({ id: inboxItems.id });
      await this.audit.record(tx, ctx, { action: 'core.inbox_item.send', entityType: 'core.inbox_item', after: { to, title: body.title } });
      await this.outbox.enqueue(tx, ctx, {
        type: CoreEvents.inboxItemCreated,
        subject: { type: 'core.inbox_item', id: rows[0]!.id },
        data: { ownerUserIds: to, kind: 'message', title: body.title },
      });
      return { delivered: rows.length };
    });
  }

  private async load(tx: Tx, id: string): Promise<Item> {
    const [item] = await tx.select().from(inboxItems).where(eq(inboxItems.id, id));
    if (!item) throw ApiError.notFound('ITEM_NOT_FOUND', 'Kartabl item not found');
    return item;
  }

  private async requireEdit(tx: Tx, ctx: TenantContext, item: Item): Promise<void> {
    if (item.createdBy === ctx.userId) return;
    if (item.ownerUserId === ctx.userId) {
      throw ApiError.forbidden('ASSIGNED_ITEM_LOCKED', 'Someone else assigned this to you; you can only change its status');
    }
    await this.scope.requireOver(tx, ctx, CORE_PERMISSIONS['inbox.manage'], item.ownerUserId);
  }

  /** inbox.assign (or inbox.manage) must reach every recipient. */
  private async requireAssignOver(tx: Tx, ctx: TenantContext, userIds: string[]): Promise<void> {
    const assign = await this.scope.area(tx, ctx, CORE_PERMISSIONS['inbox.assign']);
    const manage = await this.scope.area(tx, ctx, CORE_PERMISSIONS['inbox.manage']);
    for (const userId of userIds) {
      if (!(await this.scope.covers(tx, assign, userId)) && !(await this.scope.covers(tx, manage, userId))) {
        throw ApiError.forbidden('OUT_OF_SCOPE', 'You cannot put items in this person’s kartabl');
      }
    }
  }
}

