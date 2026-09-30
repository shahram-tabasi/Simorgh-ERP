import { describe, expect, it } from 'vitest';
import { addGrant, areaCovers, emptyArea, type UnitRef } from '../src/kernel/org/scope.js';
import { conditionsHold } from '../src/kernel/workflow/definitions.js';
import { effectiveDays, iranianWeek, proratedAccrual } from '../src/modules/hcm/domain/leave-rules.js';

describe('leave arithmetic (Kara lib/leave-balance)', () => {
  // 2026-10-03 is a Saturday; 2026-10-09 the Friday of that week
  const noHolidays = (d: string) => d === '2026-10-09';

  it('skips Fridays and holidays inside day leave unless the type counts them', () => {
    const base = { unit: 'day' as const, from: '2026-10-03', to: '2026-10-10', dailyMinutes: 510 };
    const withHoliday = (d: string) => d === '2026-10-09' || d === '2026-10-05';
    expect(effectiveDays({ ...base, countsInnerHolidays: false, isOff: noHolidays })).toBe(7);
    expect(effectiveDays({ ...base, countsInnerHolidays: false, isOff: withHoliday })).toBe(6);
    expect(effectiveDays({ ...base, countsInnerHolidays: true, isOff: withHoliday })).toBe(8);
  });

  it('turns hourly leave into a fraction of the working day of the site', () => {
    const base = { unit: 'hour' as const, countsInnerHolidays: false, from: '2026-10-03', to: '2026-10-03', isOff: noHolidays };
    expect(effectiveDays({ ...base, fromTime: '08:00', toTime: '10:00', dailyMinutes: 440 })).toBe(0.27);
    expect(effectiveDays({ ...base, fromTime: '10:00', toTime: '08:00', dailyMinutes: 510 })).toBe(0);
  });

  it('prorates the entitlement by days of service in the Jalali year', () => {
    // 1405 runs 2026-03-21 … 2027-03-20 (365 days)
    expect(proratedAccrual('2020-01-01', 1405, 26, '2027-03-20')).toBe(26);
    expect(proratedAccrual('2020-01-01', 1405, 26, '2026-03-21')).toBe(0.07);
    expect(proratedAccrual('2026-09-22', 1405, 26, '2027-03-20')).toBe(12.82);
    expect(proratedAccrual('2027-04-01', 1405, 26, '2027-05-01')).toBe(0);
  });

  it('weeks run Saturday to Friday', () => {
    expect(iranianWeek('2026-10-07')).toEqual({ from: '2026-10-03', to: '2026-10-09' });
    expect(iranianWeek('2026-10-03')).toEqual({ from: '2026-10-03', to: '2026-10-09' });
  });
});

describe('data scope', () => {
  const eng: UnitRef = { id: 'e', path: 'eng', legalEntityId: 'le1' };
  const backend: UnitRef = { id: 'b', path: 'eng.backend', legalEntityId: 'le1' };
  const sales: UnitRef = { id: 's', path: 'sales', legalEntityId: 'le2' };
  const ctxUnits = new Map([[sales.id, sales]]);

  it('org_unit scope in the tenant context reaches the holder’s units and below', () => {
    const a = emptyArea();
    addGrant(a, { scope: 'org_unit', contextType: 'tenant', contextId: null }, 'mgr', [eng], ctxUnits);
    expect(areaCovers(a, 'alice', [backend])).toBe(true);
    expect(areaCovers(a, 'carol', [sales])).toBe(false);
    expect(areaCovers(a, 'nobody', [])).toBe(false);
  });

  it('a role given in an org unit context reaches that unit whatever the scope', () => {
    const a = emptyArea();
    addGrant(a, { scope: 'tenant', contextType: 'org_unit', contextId: 's' }, 'mgr', [eng], ctxUnits);
    expect(areaCovers(a, 'carol', [sales])).toBe(true);
    expect(areaCovers(a, 'alice', [backend])).toBe(false);
  });

  it('own reaches only the holder; tenant reaches everyone; legal_entity follows the context', () => {
    const own = emptyArea();
    addGrant(own, { scope: 'own', contextType: 'tenant', contextId: null }, 'me', [eng], ctxUnits);
    expect(areaCovers(own, 'me', [])).toBe(true);
    expect(areaCovers(own, 'alice', [backend])).toBe(false);
    const all = emptyArea();
    addGrant(all, { scope: 'tenant', contextType: 'tenant', contextId: null }, 'me', [], ctxUnits);
    expect(areaCovers(all, 'anyone', [])).toBe(true);
    const le = emptyArea();
    addGrant(le, { scope: 'legal_entity', contextType: 'legal_entity', contextId: 'le2' }, 'me', [eng], ctxUnits);
    expect(areaCovers(le, 'carol', [sales])).toBe(true);
    expect(areaCovers(le, 'alice', [backend])).toBe(false);
  });

  it('a sibling path with the same prefix is not a sub-unit', () => {
    const a = emptyArea();
    addGrant(a, { scope: 'org_unit', contextType: 'tenant', contextId: null }, 'mgr', [eng], ctxUnits);
    expect(areaCovers(a, 'x', [{ id: 'x', path: 'engineering', legalEntityId: 'le1' }])).toBe(false);
  });
});

describe('workflow conditions', () => {
  it('evaluates step conditions against the document data', () => {
    expect(conditionsHold(undefined, {})).toBe(true);
    expect(conditionsHold([{ field: 'levels', op: 'gte', value: 2 }], { levels: 2 })).toBe(true);
    expect(conditionsHold([{ field: 'levels', op: 'gte', value: 3 }], { levels: 2 })).toBe(false);
    expect(conditionsHold([{ field: 'doc.total', op: 'gt', value: 5 }], { doc: { total: 9 } })).toBe(true);
    expect(conditionsHold([{ field: 'type', op: 'in', value: ['a', 'b'] }], { type: 'b' })).toBe(true);
    expect(conditionsHold([{ field: 'levels', op: 'gt', value: 1 }], { levels: '5' })).toBe(false);
  });
});
