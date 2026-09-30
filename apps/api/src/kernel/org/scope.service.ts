import { Injectable } from '@nestjs/common';
import { orgUnitMembers, orgUnits, type Tx } from '@simorgh/db';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { ApiError } from '../http/api-error.js';
import type { TenantContext } from '../http/context.js';
import { addGrant, areaCovers, emptyArea, type ScopeArea, type UnitRef } from './scope.js';

/**
 * Turns the caller's grants into the set of people a permission reaches, and
 * that set into a check or a SQL filter. Route guards only say "holds the
 * permission somewhere"; this says "over whom".
 */
@Injectable()
export class ScopeService {
  /** Units each person belongs to. */
  async unitsOf(tx: Tx, userIds: readonly string[]): Promise<Map<string, UnitRef[]>> {
    const out = new Map<string, UnitRef[]>(userIds.map((id) => [id, []]));
    if (!userIds.length) return out;
    const rows = await tx
      .select({ userId: orgUnitMembers.userId, id: orgUnits.id, path: orgUnits.path, legalEntityId: orgUnits.legalEntityId })
      .from(orgUnitMembers)
      .innerJoin(orgUnits, and(eq(orgUnits.tenantId, orgUnitMembers.tenantId), eq(orgUnits.id, orgUnitMembers.orgUnitId)))
      .where(inArray(orgUnitMembers.userId, [...userIds]));
    for (const r of rows) out.get(r.userId)!.push({ id: r.id, path: r.path, legalEntityId: r.legalEntityId });
    return out;
  }

  async unitsById(tx: Tx, ids: readonly string[]): Promise<Map<string, UnitRef>> {
    if (!ids.length) return new Map();
    const rows = await tx
      .select({ id: orgUnits.id, path: orgUnits.path, legalEntityId: orgUnits.legalEntityId })
      .from(orgUnits)
      .where(inArray(orgUnits.id, [...ids]));
    return new Map(rows.map((r) => [r.id, r]));
  }

  /** Everyone the caller reaches with `key` (empty when they do not hold it). */
  async area(tx: Tx, ctx: TenantContext, key: string): Promise<ScopeArea> {
    const grants = (ctx.grants ?? []).filter((g) => g.key === key);
    const area = emptyArea();
    if (!grants.length) return area;
    const holderUnits = (await this.unitsOf(tx, [ctx.userId])).get(ctx.userId)!;
    const contextUnits = await this.unitsById(
      tx,
      grants.filter((g) => g.contextType === 'org_unit' && g.contextId).map((g) => g.contextId!),
    );
    for (const g of grants) addGrant(area, g, ctx.userId, holderUnits, contextUnits);
    return area;
  }

  async covers(tx: Tx, area: ScopeArea, userId: string): Promise<boolean> {
    if (area.all || area.userIds.has(userId)) return true;
    return areaCovers(area, userId, (await this.unitsOf(tx, [userId])).get(userId)!);
  }

  /** The caller may act with `key` on `userId`'s records — or a 403. Acting on yourself needs no permission. */
  async requireOver(tx: Tx, ctx: TenantContext, key: string, userId: string): Promise<void> {
    if (userId === ctx.userId) return;
    if (!(await this.covers(tx, await this.area(tx, ctx, key), userId))) {
      throw ApiError.forbidden('OUT_OF_SCOPE', `${key} does not reach this person`);
    }
  }

  /** SQL condition "the person in `column` is inside `area`", for list queries. */
  condition(area: ScopeArea, column: AnyPgColumn): SQL {
    if (area.all) return sql`true`;
    const parts: SQL[] = [];
    if (area.userIds.size) parts.push(sql`${column} = any(${sql.param([...area.userIds])}::uuid[])`);
    if (area.unitPaths.size || area.legalEntityIds.size) {
      parts.push(sql`exists (
        select 1 from core.org_unit_members m
          join core.org_units u on u.tenant_id = m.tenant_id and u.id = m.org_unit_id
         where m.user_id = ${column}
           and (u.path <@ any(${sql.param([...area.unitPaths])}::ltree[]) or u.legal_entity_id = any(${sql.param([...area.legalEntityIds])}::uuid[])))`);
    }
    return parts.length ? sql`(${sql.join(parts, sql` or `)})` : sql`false`;
  }
}
