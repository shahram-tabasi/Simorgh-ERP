import { Injectable } from '@nestjs/common';
import { CoreEvents, type CreateRoleRequest, type RoleSummary, type Scope } from '@simorgh/contracts';
import { rolePermissions, roles, type Tx } from '@simorgh/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { DbService } from '../db/db.module.js';
import { ApiError } from '../http/api-error.js';
import type { TenantContext } from '../http/context.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { PermissionCatalogService } from './permission-catalog.service.js';
import { RbacService } from './rbac.service.js';

type GrantInput = { key: string; scope: Scope };

@Injectable()
export class RolesService {
  constructor(
    private readonly db: DbService,
    private readonly catalog: PermissionCatalogService,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  list(ctx: TenantContext): Promise<RoleSummary[]> {
    return this.db.tenant(ctx, (tx) => this.summaries(tx));
  }

  create(ctx: TenantContext, body: CreateRoleRequest): Promise<RoleSummary> {
    const grants = this.validate(body.permissions);
    return this.db.tenant(ctx, async (tx) => {
      const [role] = await tx
        .insert(roles)
        .values({ tenantId: sql`core.current_tenant()`, key: body.key, name: body.name, description: body.description ?? null })
        .returning();
      await this.writeGrants(tx, role!.id, grants);
      const summary = (await this.summaries(tx, role!.id))[0]!;
      await this.audit.record(tx, ctx, { action: 'core.role.create', entityType: 'core.role', entityId: role!.id, after: summary });
      await this.outbox.enqueue(tx, ctx, { type: CoreEvents.roleChanged, subject: { type: 'core.role', id: role!.id }, data: summary });
      return summary;
    });
  }

  setPermissions(ctx: TenantContext, roleId: string, input: GrantInput[]): Promise<RoleSummary> {
    const grants = this.validate(input);
    return this.db.tenant(ctx, async (tx) => {
      const before = (await this.summaries(tx, roleId))[0];
      if (!before) throw ApiError.notFound('ROLE_NOT_FOUND', 'Role not found');
      if (before.isSystem) throw ApiError.conflict('ROLE_IS_SYSTEM', 'System roles cannot be changed');
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
      await this.writeGrants(tx, roleId, grants);
      await this.rbac.bumpRoleHolders(tx, roleId);
      const after = (await this.summaries(tx, roleId))[0]!;
      await this.audit.record(tx, ctx, { action: 'core.role.set_permissions', entityType: 'core.role', entityId: roleId, before, after });
      await this.outbox.enqueue(tx, ctx, { type: CoreEvents.roleChanged, subject: { type: 'core.role', id: roleId }, data: after });
      return after;
    });
  }

  remove(ctx: TenantContext, roleId: string): Promise<void> {
    return this.db.tenant(ctx, async (tx) => {
      const before = (await this.summaries(tx, roleId))[0];
      if (!before) throw ApiError.notFound('ROLE_NOT_FOUND', 'Role not found');
      if (before.isSystem) throw ApiError.conflict('ROLE_IS_SYSTEM', 'System roles cannot be deleted');
      await this.rbac.bumpRoleHolders(tx, roleId); // before the assignments cascade away
      await tx.delete(roles).where(eq(roles.id, roleId));
      await this.audit.record(tx, ctx, { action: 'core.role.delete', entityType: 'core.role', entityId: roleId, before });
    });
  }

  /** Grants must name permissions this build knows, at a scope the permission allows. */
  private validate(input: GrantInput[]): GrantInput[] {
    const seen = new Set<string>();
    for (const g of input) {
      const def = this.catalog.get(g.key);
      if (!def) throw ApiError.badRequest('UNKNOWN_PERMISSION', `Unknown permission ${g.key}`);
      if (!def.scopes.includes(g.scope)) {
        throw ApiError.badRequest('SCOPE_NOT_ALLOWED', `${g.key} cannot be granted at scope ${g.scope}`);
      }
      if (seen.has(g.key)) throw ApiError.badRequest('DUPLICATE_PERMISSION', `${g.key} is listed twice`);
      seen.add(g.key);
    }
    return input;
  }

  private async writeGrants(tx: Tx, roleId: string, grants: GrantInput[]): Promise<void> {
    if (!grants.length) return;
    await tx.insert(rolePermissions).values(
      grants.map((g) => ({ tenantId: sql`core.current_tenant()`, roleId, permissionKey: g.key, scope: g.scope })),
    );
  }

  private async summaries(tx: Tx, roleId?: string): Promise<RoleSummary[]> {
    const rows = await tx
      .select({ role: roles, key: rolePermissions.permissionKey, scope: rolePermissions.scope })
      .from(roles)
      .leftJoin(rolePermissions, and(eq(rolePermissions.tenantId, roles.tenantId), eq(rolePermissions.roleId, roles.id)))
      .where(roleId ? eq(roles.id, roleId) : undefined)
      .orderBy(asc(roles.key), asc(rolePermissions.permissionKey));
    const byId = new Map<string, RoleSummary>();
    for (const r of rows) {
      let s = byId.get(r.role.id);
      if (!s) {
        s = { id: r.role.id, key: r.role.key, name: r.role.name, description: r.role.description, isSystem: r.role.isSystem, permissions: [] };
        byId.set(r.role.id, s);
      }
      if (r.key) s.permissions.push({ key: r.key, scope: r.scope! });
    }
    return [...byId.values()];
  }
}
