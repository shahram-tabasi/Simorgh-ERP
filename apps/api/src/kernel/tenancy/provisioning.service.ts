import { Injectable } from '@nestjs/common';
import { CORE_PERMISSIONS, CoreEvents, type CreateTenantRequest, type TenantSummary } from '@simorgh/contracts';
import { enterTenant, legalEntities, rolePermissions, roles, tenantMemberships, tenants, userRoles, users } from '@simorgh/db';
import { desc, eq, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { DbService } from '../db/db.module.js';
import { ApiError } from '../http/api-error.js';
import type { RequestContext } from '../http/context.js';
import { PasswordService } from '../identity/password.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { PermissionCatalogService } from '../rbac/permission-catalog.service.js';
import { ADMIN_ROLE_KEY } from '../rbac/rbac.service.js';

export interface ProvisionedTenant extends TenantSummary {
  legalEntityId: string;
  ownerUserId: string;
}

/** Permissions of the default `member` role: enough to see the company, nothing to change. */
const MEMBER_DEFAULTS = [CORE_PERMISSIONS['legal_entity.view']];

@Injectable()
export class ProvisioningService {
  constructor(
    private readonly db: DbService,
    private readonly passwords: PasswordService,
    private readonly catalog: PermissionCatalogService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  list(ctx: RequestContext): Promise<TenantSummary[]> {
    return this.db.platform(ctx.userId, async (tx) =>
      (await tx.select().from(tenants).orderBy(desc(tenants.createdAt))).map(summary),
    );
  }

  /**
   * Creates a tenant with its first legal entity, the two system roles, and
   * its owner — all in one transaction, so a tenant is never half-made.
   * (Kara did the same in `provision.ts`, one schema per company; here it is
   * rows in shared tables under RLS.)
   */
  async provision(ctx: RequestContext, body: CreateTenantRequest): Promise<ProvisionedTenant> {
    const ownerHash = body.owner.password ? await this.passwords.hash(body.owner.password) : null;

    return this.db.platform(ctx.userId, async (tx) => {
      const [tenant] = await tx.insert(tenants).values({ code: body.code, name: body.name }).returning();

      let [owner] = await tx.select().from(users).where(eq(users.email, body.owner.email));
      if (!owner) {
        if (!ownerHash) throw ApiError.badRequest('OWNER_PASSWORD_REQUIRED', 'The owner has no account yet; give a password');
        [owner] = await tx
          .insert(users)
          .values({ email: body.owner.email, displayName: body.owner.displayName, passwordHash: ownerHash })
          .returning();
      }

      // From here on the transaction is inside the new tenant: RLS applies.
      await enterTenant(tx, tenant!.id);
      const tid = sql`core.current_tenant()`;

      const [le] = await tx
        .insert(legalEntities)
        .values({
          tenantId: tid,
          code: body.legalEntity.code,
          name: body.legalEntity.name,
          nationalId: body.legalEntity.nationalId ?? null,
          economicCode: body.legalEntity.economicCode ?? null,
          baseCurrency: body.legalEntity.baseCurrency,
        })
        .returning();

      const [admin, member] = await tx
        .insert(roles)
        .values([
          { tenantId: tid, key: ADMIN_ROLE_KEY, name: 'مدیر سامانه', description: 'دسترسی کامل به همهٔ بخش‌ها', isSystem: true },
          { tenantId: tid, key: 'member', name: 'کاربر', description: 'دسترسی پایه', isSystem: true },
        ])
        .returning();
      await tx.insert(rolePermissions).values([
        ...this.catalog.all().map((d) => ({ tenantId: tid, roleId: admin!.id, permissionKey: d.key, scope: 'tenant' as const })),
        ...MEMBER_DEFAULTS.map((key) => ({ tenantId: tid, roleId: member!.id, permissionKey: key, scope: 'tenant' as const })),
      ]);

      await tx.insert(tenantMemberships).values({ tenantId: tid, userId: owner!.id, isOwner: true, status: 'active' });
      await tx.insert(userRoles).values({ tenantId: tid, userId: owner!.id, roleId: admin!.id });

      const result: ProvisionedTenant = { ...summary(tenant!), legalEntityId: le!.id, ownerUserId: owner!.id };
      await this.audit.record(tx, ctx, { action: 'core.tenant.provision', entityType: 'core.tenant', entityId: tenant!.id, after: result });
      await this.outbox.enqueue(tx, ctx, {
        type: CoreEvents.tenantProvisioned,
        subject: { type: 'core.tenant', id: tenant!.id, no: tenant!.code },
        legalEntityId: le!.id,
        data: { code: tenant!.code, name: tenant!.name, ownerUserId: owner!.id },
      });
      return result;
    });
  }
}

function summary(t: typeof tenants.$inferSelect): TenantSummary {
  return { id: t.id, code: t.code, name: t.name, status: t.status, createdAt: t.createdAt.toISOString() };
}
