import { Injectable } from '@nestjs/common';
import { rolePermissions, roles, tenantMemberships, tenants, userRoles, users, type ContextType, type Scope, type Tx } from '@simorgh/db';
import { and, eq, gte, isNull, or, sql } from 'drizzle-orm';
import { DbService } from '../db/db.module.js';
import { PermissionCatalogService } from './permission-catalog.service.js';

/** One permission a member holds, with where it applies (architecture §6.4). */
export interface Grant {
  key: string;
  scope: Scope;
  contextType: ContextType;
  contextId: string | null;
}

export interface TenantPrincipal {
  permVer: number;
  isOwner: boolean;
  grants: Grant[];
}

const CACHE_TTL_MS = 60_000;

/** Key of the system role every tenant's owner gets at provisioning. */
export const ADMIN_ROLE_KEY = 'admin';
/** Key of the system role every member gets when they join. */
export const MEMBER_ROLE_KEY = 'member';

@Injectable()
export class RbacService {
  // Keyed by tenant:user:perm_ver — any role change bumps perm_ver, so a stale
  // entry can never be read; the TTL only bounds memory and valid_until expiry.
  private readonly cache = new Map<string, { at: number; grants: Grant[] }>();

  constructor(
    private readonly db: DbService,
    private readonly catalog: PermissionCatalogService,
  ) {}

  /**
   * The caller as a member of their tenant, or null when the membership, the
   * user or the tenant itself is gone, disabled or suspended. Checked on every
   * tenant request, so any of those takes effect on the next call, not when
   * the access token expires.
   */
  async principal(tenantId: string, userId: string): Promise<TenantPrincipal | null> {
    return this.db.tenant({ tenantId, userId }, async (tx) => {
      const [m] = await tx
        .select({
          status: tenantMemberships.status,
          permVer: tenantMemberships.permVer,
          isOwner: tenantMemberships.isOwner,
          active: users.isActive,
          tenantStatus: tenants.status,
        })
        .from(tenantMemberships)
        .innerJoin(users, eq(users.id, tenantMemberships.userId))
        .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
        .where(eq(tenantMemberships.userId, userId));
      if (!m || m.status !== 'active' || !m.active) return null;
      if (m.tenantStatus !== 'active' && m.tenantStatus !== 'trial') return null;

      const key = `${tenantId}:${userId}:${m.permVer}`;
      const hit = this.cache.get(key);
      if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { permVer: m.permVer, isOwner: m.isOwner, grants: hit.grants };

      const grants = await this.loadGrants(tx, userId);
      this.cache.set(key, { at: Date.now(), grants });
      if (this.cache.size > 10_000) this.cache.delete(this.cache.keys().next().value!);
      return { permVer: m.permVer, isOwner: m.isOwner, grants };
    });
  }

  private async loadGrants(tx: Tx, userId: string): Promise<Grant[]> {
    const rows = await tx
      .select({
        key: rolePermissions.permissionKey,
        scope: rolePermissions.scope,
        contextType: userRoles.contextType,
        contextId: userRoles.contextId,
        roleKey: roles.key,
        isSystem: roles.isSystem,
      })
      .from(userRoles)
      .innerJoin(roles, and(eq(roles.tenantId, userRoles.tenantId), eq(roles.id, userRoles.roleId)))
      .leftJoin(
        rolePermissions,
        and(eq(rolePermissions.tenantId, userRoles.tenantId), eq(rolePermissions.roleId, userRoles.roleId)),
      )
      .where(and(eq(userRoles.userId, userId), or(isNull(userRoles.validUntil), gte(userRoles.validUntil, sql`current_date`))));

    // The system admin role means "everything this build knows", including
    // permissions added by modules after the tenant was provisioned.
    if (rows.some((r) => r.isSystem && r.roleKey === ADMIN_ROLE_KEY && r.contextType === 'tenant')) {
      return this.catalog.all().map((d) => ({ key: d.key, scope: 'tenant' as Scope, contextType: 'tenant' as ContextType, contextId: null }));
    }
    return rows
      .filter((r) => r.key !== null)
      .map((r) => ({ key: r.key!, scope: r.scope!, contextType: r.contextType, contextId: r.contextId }));
  }

  /** Invalidates cached permissions of everyone holding `roleId` (call inside the changing tx). */
  async bumpRoleHolders(tx: Tx, roleId: string): Promise<void> {
    await tx.execute(sql`
      update core.tenant_memberships m set perm_ver = perm_ver + 1
       where m.user_id in (select ur.user_id from core.user_roles ur where ur.role_id = ${roleId})`);
  }

  async bumpUser(tx: Tx, userId: string): Promise<void> {
    await tx.update(tenantMemberships).set({ permVer: sql`${tenantMemberships.permVer} + 1` }).where(eq(tenantMemberships.userId, userId));
  }
}

/** True when any grant carries `key` (scope/context filtering belongs to the data layer). */
export function holds(grants: readonly Grant[] | undefined, key: string): boolean {
  return !!grants?.some((g) => g.key === key);
}
