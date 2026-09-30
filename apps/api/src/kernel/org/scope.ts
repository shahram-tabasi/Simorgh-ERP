import type { Grant } from '../rbac/rbac.service.js';

/**
 * Data scope (architecture §6.4): which people a permission reaches.
 *
 * A grant is a permission at a scope (own / org_unit / legal_entity / tenant),
 * held through a role assigned in a context (the tenant, one legal entity, one
 * org unit). The context narrows the scope:
 *
 *   context \ scope   own     org_unit                legal_entity / tenant
 *   tenant            self    holder's units ↓        holder's companies / all
 *   legal_entity L    self    holder's units in L ↓   L
 *   org_unit X        self    X ↓                     X ↓
 *
 * (↓ = the unit and every unit under it.) A project context reaches only the
 * holder until projects exist.
 */
export interface ScopeArea {
  all: boolean;
  userIds: Set<string>;
  /** ltree paths as text; a person is inside when one of their units is at or under one. */
  unitPaths: Set<string>;
  legalEntityIds: Set<string>;
}

export interface UnitRef {
  id: string;
  path: string;
  legalEntityId: string;
}

export const emptyArea = (): ScopeArea => ({ all: false, userIds: new Set(), unitPaths: new Set(), legalEntityIds: new Set() });

export function isEmptyArea(a: ScopeArea): boolean {
  return !a.all && !a.userIds.size && !a.unitPaths.size && !a.legalEntityIds.size;
}

/** Adds what `grant`, held by `holderId`, reaches to `area`. */
export function addGrant(
  area: ScopeArea,
  grant: Pick<Grant, 'scope' | 'contextType' | 'contextId'>,
  holderId: string,
  holderUnits: readonly UnitRef[],
  contextUnits: ReadonlyMap<string, UnitRef>,
): void {
  if (grant.scope === 'own') {
    area.userIds.add(holderId);
    return;
  }
  if (grant.scope === 'project') return; // no projects yet
  switch (grant.contextType) {
    case 'tenant':
      if (grant.scope === 'tenant') area.all = true;
      else if (grant.scope === 'legal_entity') for (const u of holderUnits) area.legalEntityIds.add(u.legalEntityId);
      else for (const u of holderUnits) area.unitPaths.add(u.path);
      return;
    case 'legal_entity':
      if (grant.scope === 'org_unit') {
        for (const u of holderUnits) if (u.legalEntityId === grant.contextId) area.unitPaths.add(u.path);
      } else if (grant.contextId) area.legalEntityIds.add(grant.contextId);
      return;
    case 'org_unit': {
      const unit = grant.contextId ? contextUnits.get(grant.contextId) : undefined;
      if (unit) area.unitPaths.add(unit.path);
      return;
    }
    case 'project':
      return;
  }
}

/** Whether `area` reaches the person `userId`, who belongs to `units`. */
export function areaCovers(area: ScopeArea, userId: string, units: readonly UnitRef[]): boolean {
  if (area.all || area.userIds.has(userId)) return true;
  return units.some((u) => area.legalEntityIds.has(u.legalEntityId) || [...area.unitPaths].some((p) => isUnder(u.path, p)));
}

/** ltree `a <@ b` on text paths. */
export function isUnder(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}.`);
}
