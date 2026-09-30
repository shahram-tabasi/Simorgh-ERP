import { Injectable } from '@nestjs/common';
import { CoreEvents, type CreateOrgUnitRequest, type OrgUnitSummary, type UpdateOrgUnitRequest } from '@simorgh/contracts';
import { legalEntities, orgUnitMembers, orgUnits, tenantMemberships, users, type Tx } from '@simorgh/db';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { DbService } from '../db/db.module.js';
import { ApiError } from '../http/api-error.js';
import type { TenantContext } from '../http/context.js';
import { pgError } from '../http/pg-error.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { isUnder } from './scope.js';

export interface Recipients {
  userIds?: string[];
  orgUnitId?: string;
  includeSubUnits?: boolean;
}

export interface OrgUnitMember {
  userId: string;
  displayName: string;
  email: string | null;
  isPrimary: boolean;
  isManager: boolean;
}

/** The organisation tree (Kara "groups"): units, their managers and members. */
@Injectable()
export class OrgService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  list(ctx: TenantContext): Promise<OrgUnitSummary[]> {
    return this.db.tenant(ctx, (tx) => this.summaries(tx));
  }

  create(ctx: TenantContext, body: CreateOrgUnitRequest): Promise<OrgUnitSummary> {
    return this.db.tenant(ctx, async (tx) => {
      let legalEntityId = body.legalEntityId;
      if (body.parentId) {
        const parent = await this.require(tx, body.parentId);
        if (legalEntityId && legalEntityId !== parent.legalEntityId) {
          throw ApiError.badRequest('LEGAL_ENTITY_MISMATCH', 'A unit belongs to the same legal entity as its parent');
        }
        legalEntityId = parent.legalEntityId;
      }
      if (!legalEntityId) {
        const les = await tx.select({ id: legalEntities.id }).from(legalEntities).limit(2);
        if (les.length !== 1) throw ApiError.badRequest('LEGAL_ENTITY_REQUIRED', 'Say which legal entity the unit belongs to');
        legalEntityId = les[0]!.id;
      }
      if (body.managerUserId) await this.requireActiveMember(tx, body.managerUserId);

      const [unit] = await tx
        .insert(orgUnits)
        .values({
          tenantId: sql`core.current_tenant()`,
          legalEntityId,
          parentId: body.parentId ?? null,
          code: body.code,
          name: body.name,
          managerUserId: body.managerUserId ?? null,
          workScheduleId: body.workScheduleId ?? null,
          path: sql`''::ltree`, // replaced by the org_unit_path trigger
        })
        .returning()
        .catch((err: unknown) => {
          if (pgError(err)?.code === '23505') throw ApiError.conflict('ORG_UNIT_CODE_TAKEN', 'Another unit has this code');
          throw err;
        });
      // the manager is a member of the unit they manage (as in Kara)
      if (body.managerUserId) await this.addMember(tx, unit!.id, body.managerUserId, false);

      const after = (await this.summaries(tx, unit!.id))[0]!;
      await this.audit.record(tx, ctx, { action: 'core.org_unit.create', entityType: 'core.org_unit', entityId: unit!.id, after });
      await this.outbox.enqueue(tx, ctx, { type: CoreEvents.orgUnitChanged, subject: { type: 'core.org_unit', id: unit!.id, no: unit!.code }, legalEntityId, data: after });
      return after;
    });
  }

  update(ctx: TenantContext, id: string, body: UpdateOrgUnitRequest): Promise<OrgUnitSummary> {
    return this.db.tenant(ctx, async (tx) => {
      const before = (await this.summaries(tx, id))[0];
      if (!before) throw ApiError.notFound('ORG_UNIT_NOT_FOUND', 'Org unit not found');
      if (body.parentId) {
        const parent = await this.require(tx, body.parentId);
        if (parent.legalEntityId !== before.legalEntityId) {
          throw ApiError.badRequest('LEGAL_ENTITY_MISMATCH', 'A unit belongs to the same legal entity as its parent');
        }
      }
      if (body.managerUserId) await this.requireActiveMember(tx, body.managerUserId);

      await tx
        .update(orgUnits)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
          ...(body.managerUserId !== undefined ? { managerUserId: body.managerUserId } : {}),
          ...(body.workScheduleId !== undefined ? { workScheduleId: body.workScheduleId } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        })
        .where(eq(orgUnits.id, id))
        .catch((err: unknown) => {
          if (pgError(err)?.constraint === 'org_units_no_cycle') {
            throw ApiError.conflict('ORG_UNIT_CYCLE', 'A unit cannot be moved under itself or one of its sub-units');
          }
          throw err;
        });
      if (body.managerUserId) await this.addMember(tx, id, body.managerUserId, false);

      const after = (await this.summaries(tx, id))[0]!;
      await this.audit.record(tx, ctx, { action: 'core.org_unit.update', entityType: 'core.org_unit', entityId: id, before, after });
      await this.outbox.enqueue(tx, ctx, { type: CoreEvents.orgUnitChanged, subject: { type: 'core.org_unit', id, no: after.code }, legalEntityId: after.legalEntityId, data: after });
      return after;
    });
  }

  remove(ctx: TenantContext, id: string): Promise<void> {
    return this.db.tenant(ctx, async (tx) => {
      const before = (await this.summaries(tx, id))[0];
      if (!before) throw ApiError.notFound('ORG_UNIT_NOT_FOUND', 'Org unit not found');
      const [child] = await tx.select({ id: orgUnits.id }).from(orgUnits).where(eq(orgUnits.parentId, id)).limit(1);
      if (child) throw ApiError.conflict('ORG_UNIT_HAS_CHILDREN', 'Move or delete the sub-units first');
      await tx.delete(orgUnits).where(eq(orgUnits.id, id));
      await this.audit.record(tx, ctx, { action: 'core.org_unit.delete', entityType: 'core.org_unit', entityId: id, before });
    });
  }

  members(ctx: TenantContext, id: string): Promise<OrgUnitMember[]> {
    return this.db.tenant(ctx, async (tx) => {
      const unit = await this.require(tx, id);
      const rows = await tx
        .select({ userId: orgUnitMembers.userId, displayName: users.displayName, email: users.email, isPrimary: orgUnitMembers.isPrimary })
        .from(orgUnitMembers)
        .innerJoin(users, eq(users.id, orgUnitMembers.userId))
        .where(eq(orgUnitMembers.orgUnitId, id))
        .orderBy(asc(users.displayName));
      return rows.map((r) => ({ ...r, isManager: r.userId === unit.managerUserId }));
    });
  }

  setMember(ctx: TenantContext, id: string, userId: string, isPrimary: boolean): Promise<OrgUnitMember[]> {
    return this.db
      .tenant(ctx, async (tx) => {
        await this.require(tx, id);
        await this.requireActiveMember(tx, userId);
        await this.addMember(tx, id, userId, isPrimary);
        await this.audit.record(tx, ctx, { action: 'core.org_unit.set_member', entityType: 'core.org_unit', entityId: id, after: { userId, isPrimary } });
      })
      .then(() => this.members(ctx, id));
  }

  removeMember(ctx: TenantContext, id: string, userId: string): Promise<void> {
    return this.db.tenant(ctx, async (tx) => {
      await this.require(tx, id);
      const gone = await tx
        .delete(orgUnitMembers)
        .where(and(eq(orgUnitMembers.orgUnitId, id), eq(orgUnitMembers.userId, userId)))
        .returning();
      if (!gone.length) throw ApiError.notFound('NOT_A_MEMBER', 'Not a member of this unit');
      // someone who leaves a unit no longer manages it
      await tx.update(orgUnits).set({ managerUserId: null }).where(and(eq(orgUnits.id, id), eq(orgUnits.managerUserId, userId)));
      await this.audit.record(tx, ctx, { action: 'core.org_unit.remove_member', entityType: 'core.org_unit', entityId: id, before: { userId } });
    });
  }

  /**
   * People a message or a task goes to: the given members, or everyone in a
   * unit (and, if asked, its sub-units). Only active members are returned; an
   * unknown or disabled person in `userIds` is an error, not silently dropped.
   */
  async resolveRecipients(tx: Tx, to: Recipients): Promise<string[]> {
    if (to.orgUnitId) {
      const unit = await this.require(tx, to.orgUnitId);
      const rows = await tx
        .selectDistinct({ userId: orgUnitMembers.userId })
        .from(orgUnitMembers)
        .innerJoin(orgUnits, and(eq(orgUnits.tenantId, orgUnitMembers.tenantId), eq(orgUnits.id, orgUnitMembers.orgUnitId)))
        .innerJoin(
          tenantMemberships,
          and(eq(tenantMemberships.tenantId, orgUnitMembers.tenantId), eq(tenantMemberships.userId, orgUnitMembers.userId)),
        )
        .where(
          and(
            to.includeSubUnits ? sql`${orgUnits.path} <@ ${unit.path}::ltree` : eq(orgUnits.id, unit.id),
            eq(tenantMemberships.status, 'active'),
          ),
        );
      if (!rows.length) throw ApiError.badRequest('ORG_UNIT_EMPTY', 'This unit has no members');
      return rows.map((r) => r.userId);
    }
    const ids = [...new Set(to.userIds ?? [])];
    const found = await tx
      .select({ userId: tenantMemberships.userId })
      .from(tenantMemberships)
      .where(and(inArray(tenantMemberships.userId, ids), eq(tenantMemberships.status, 'active')));
    if (found.length !== ids.length) throw ApiError.badRequest('UNKNOWN_MEMBER', 'Some recipients are not active members');
    return ids;
  }

  /**
   * The managers of a person: for each unit they belong to, the manager of
   * the nearest unit at or above it that has one — skipping the person
   * themselves, so a unit manager's own request goes to the manager above.
   */
  async managersOf(tx: Tx, userId: string): Promise<string[]> {
    const own = await tx
      .select({ path: orgUnits.path })
      .from(orgUnitMembers)
      .innerJoin(orgUnits, and(eq(orgUnits.tenantId, orgUnitMembers.tenantId), eq(orgUnits.id, orgUnitMembers.orgUnitId)))
      .where(eq(orgUnitMembers.userId, userId));
    if (!own.length) return [];
    const ancestors = await tx
      .select({ path: orgUnits.path, managerUserId: orgUnits.managerUserId })
      .from(orgUnits)
      .where(sql`${orgUnits.path} @> any(${sql.param(own.map((o) => o.path))}::ltree[]) and ${orgUnits.managerUserId} is not null and ${orgUnits.isActive}`);
    const out = new Set<string>();
    for (const { path } of own) {
      const nearest = ancestors
        .filter((a) => a.managerUserId !== userId && isUnder(path, a.path))
        .sort((a, b) => b.path.length - a.path.length)[0];
      if (nearest) out.add(nearest.managerUserId!);
    }
    return [...out];
  }

  private async addMember(tx: Tx, unitId: string, userId: string, isPrimary: boolean): Promise<void> {
    if (isPrimary) await tx.update(orgUnitMembers).set({ isPrimary: false }).where(eq(orgUnitMembers.userId, userId));
    await tx
      .insert(orgUnitMembers)
      .values({ tenantId: sql`core.current_tenant()`, orgUnitId: unitId, userId, isPrimary })
      .onConflictDoUpdate({
        target: [orgUnitMembers.tenantId, orgUnitMembers.orgUnitId, orgUnitMembers.userId],
        set: isPrimary ? { isPrimary: true } : { userId: sql`excluded.user_id` },
      });
  }

  private async require(tx: Tx, id: string) {
    const [u] = await tx.select().from(orgUnits).where(eq(orgUnits.id, id));
    if (!u) throw ApiError.notFound('ORG_UNIT_NOT_FOUND', 'Org unit not found');
    return u;
  }

  private async requireActiveMember(tx: Tx, userId: string): Promise<void> {
    const [m] = await tx.select({ status: tenantMemberships.status }).from(tenantMemberships).where(eq(tenantMemberships.userId, userId));
    if (m?.status !== 'active') throw ApiError.badRequest('UNKNOWN_MEMBER', 'Not an active member of this company');
  }

  private async summaries(tx: Tx, id?: string): Promise<OrgUnitSummary[]> {
    const rows = await tx
      .select({
        u: orgUnits,
        depth: sql<number>`nlevel(${orgUnits.path}) - 1`.mapWith(Number),
        memberCount: sql<number>`(select count(*) from core.org_unit_members m where m.org_unit_id = ${orgUnits.id})`.mapWith(Number),
      })
      .from(orgUnits)
      .where(id ? eq(orgUnits.id, id) : undefined)
      .orderBy(asc(orgUnits.path));
    return rows.map(({ u, depth, memberCount }) => ({
      id: u.id,
      code: u.code,
      name: u.name,
      parentId: u.parentId,
      legalEntityId: u.legalEntityId,
      managerUserId: u.managerUserId,
      workScheduleId: u.workScheduleId,
      isActive: u.isActive,
      depth,
      memberCount,
    }));
  }
}
