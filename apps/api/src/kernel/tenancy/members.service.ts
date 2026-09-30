import { Injectable } from '@nestjs/common';
import { CoreEvents, type AddMemberRequest, type AssignRoleRequest, type MemberSummary } from '@simorgh/contracts';
import { roles, tenantMemberships, userRoles, users, type Tx } from '@simorgh/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { DbService } from '../db/db.module.js';
import { ApiError } from '../http/api-error.js';
import type { TenantContext } from '../http/context.js';
import { PasswordService } from '../identity/password.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { ADMIN_ROLE_KEY, MEMBER_ROLE_KEY, RbacService } from '../rbac/rbac.service.js';

@Injectable()
export class MembersService {
  constructor(
    private readonly db: DbService,
    private readonly passwords: PasswordService,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  list(ctx: TenantContext): Promise<MemberSummary[]> {
    return this.db.tenant(ctx, (tx) => this.summaries(tx));
  }

  /**
   * Adds a person to the tenant. A person who already has a Simorgh account
   * joins with it; a password given for them is ignored — nobody sets another
   * account's password by inviting it.
   */
  async add(ctx: TenantContext, body: AddMemberRequest): Promise<MemberSummary> {
    const hash = body.password ? await this.passwords.hash(body.password) : null;
    return this.db.tenant(ctx, async (tx) => {
      let [user] = await tx.select().from(users).where(eq(users.email, body.email));
      if (!user) {
        if (!hash) throw ApiError.badRequest('PASSWORD_REQUIRED', 'This person has no account yet; give a password');
        [user] = await tx.insert(users).values({ email: body.email, displayName: body.displayName, passwordHash: hash }).returning();
      }
      const inserted = await tx
        .insert(tenantMemberships)
        .values({ tenantId: sql`core.current_tenant()`, userId: user!.id, status: 'active' })
        .onConflictDoNothing()
        .returning();
      if (!inserted.length) throw ApiError.conflict('MEMBER_EXISTS', 'Already a member');
      // everyone starts with the basic system role (it can be taken away later)
      const [basic] = await tx.select({ id: roles.id }).from(roles).where(and(eq(roles.key, MEMBER_ROLE_KEY), eq(roles.isSystem, true)));
      if (basic) await tx.insert(userRoles).values({ tenantId: sql`core.current_tenant()`, userId: user!.id, roleId: basic.id });

      const member = (await this.summaries(tx, user!.id))[0]!;
      await this.audit.record(tx, ctx, { action: 'core.member.add', entityType: 'core.user', entityId: user!.id, after: member });
      await this.outbox.enqueue(tx, ctx, { type: CoreEvents.memberAdded, subject: { type: 'core.user', id: user!.id }, data: member });
      return member;
    });
  }

  setStatus(ctx: TenantContext, userId: string, status: 'active' | 'disabled'): Promise<MemberSummary> {
    return this.db.tenant(ctx, async (tx) => {
      const before = await this.require(tx, userId);
      if (before.isOwner && status !== 'active') throw ApiError.conflict('OWNER_PROTECTED', 'The tenant owner cannot be disabled');
      await tx
        .update(tenantMemberships)
        .set({ status, permVer: sql`${tenantMemberships.permVer} + 1` })
        .where(eq(tenantMemberships.userId, userId));
      const after = (await this.summaries(tx, userId))[0]!;
      await this.audit.record(tx, ctx, { action: 'core.member.set_status', entityType: 'core.user', entityId: userId, before, after });
      return after;
    });
  }

  assignRole(ctx: TenantContext, userId: string, body: AssignRoleRequest): Promise<MemberSummary> {
    return this.db.tenant(ctx, async (tx) => {
      const before = await this.require(tx, userId);
      const [role] = await tx.select().from(roles).where(eq(roles.id, body.roleId));
      if (!role) throw ApiError.notFound('ROLE_NOT_FOUND', 'Role not found');
      const [assignment] = await tx
        .insert(userRoles)
        .values({
          tenantId: sql`core.current_tenant()`,
          userId,
          roleId: body.roleId,
          contextType: body.contextType,
          contextId: body.contextId ?? null,
          validUntil: body.validUntil ?? null,
        })
        .onConflictDoNothing()
        .returning();
      if (!assignment) throw ApiError.conflict('ROLE_ALREADY_ASSIGNED', 'Role already assigned in this context');
      await this.rbac.bumpUser(tx, userId);
      const after = (await this.summaries(tx, userId))[0]!;
      await this.audit.record(tx, ctx, { action: 'core.member.assign_role', entityType: 'core.user', entityId: userId, before, after });
      await this.outbox.enqueue(tx, ctx, {
        type: CoreEvents.roleAssigned,
        subject: { type: 'core.user', id: userId },
        data: { roleId: role.id, roleKey: role.key, contextType: body.contextType, contextId: body.contextId ?? null },
      });
      return after;
    });
  }

  unassignRole(ctx: TenantContext, userId: string, assignmentId: string): Promise<MemberSummary> {
    return this.db.tenant(ctx, async (tx) => {
      const before = await this.require(tx, userId);
      const target = before.roles.find((r) => r.assignmentId === assignmentId);
      if (!target) throw ApiError.notFound('ASSIGNMENT_NOT_FOUND', 'Role assignment not found');
      if (before.isOwner && target.roleKey === ADMIN_ROLE_KEY) {
        throw ApiError.conflict('OWNER_PROTECTED', "The owner's administrator role cannot be removed");
      }
      await tx.delete(userRoles).where(eq(userRoles.id, assignmentId));
      await this.rbac.bumpUser(tx, userId);
      const after = (await this.summaries(tx, userId))[0]!;
      await this.audit.record(tx, ctx, { action: 'core.member.unassign_role', entityType: 'core.user', entityId: userId, before, after });
      return after;
    });
  }

  private async require(tx: Tx, userId: string): Promise<MemberSummary> {
    const m = (await this.summaries(tx, userId))[0];
    if (!m) throw ApiError.notFound('MEMBER_NOT_FOUND', 'Member not found');
    return m;
  }

  private async summaries(tx: Tx, userId?: string): Promise<MemberSummary[]> {
    const rows = await tx
      .select({
        m: tenantMemberships,
        email: users.email,
        displayName: users.displayName,
        assignmentId: userRoles.id,
        roleId: userRoles.roleId,
        contextType: userRoles.contextType,
        contextId: userRoles.contextId,
        roleKey: roles.key,
      })
      .from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .leftJoin(userRoles, and(eq(userRoles.tenantId, tenantMemberships.tenantId), eq(userRoles.userId, tenantMemberships.userId)))
      .leftJoin(roles, and(eq(roles.tenantId, userRoles.tenantId), eq(roles.id, userRoles.roleId)))
      .where(userId ? eq(tenantMemberships.userId, userId) : undefined)
      .orderBy(asc(users.displayName), asc(roles.key));
    const byUser = new Map<string, MemberSummary>();
    for (const r of rows) {
      let s = byUser.get(r.m.userId);
      if (!s) {
        s = { userId: r.m.userId, email: r.email, displayName: r.displayName, status: r.m.status, isOwner: r.m.isOwner, roles: [] };
        byUser.set(r.m.userId, s);
      }
      if (r.assignmentId) {
        s.roles.push({ assignmentId: r.assignmentId, roleId: r.roleId!, roleKey: r.roleKey!, contextType: r.contextType!, contextId: r.contextId });
      }
    }
    return [...byUser.values()];
  }
}
