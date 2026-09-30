import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  createTestApp,
  grantRole,
  joinUnit,
  orgUnit,
  platformToken,
  provisionTenant,
  seedPlatformAdmin,
  type TenantFixture,
  type TestApp,
} from './harness.js';

type Person = { userId: string; token: string };

describe('M2 kernel: org units, scope, kartabl, tasks, calendar', () => {
  let t: TestApp;
  let acme: TenantFixture;
  let globex: TenantFixture;
  let mgr: Person, alice: Person, bob: Person, carol: Person;
  let eng: string, backend: string, sales: string;

  beforeAll(async () => {
    t = await createTestApp();
    await seedPlatformAdmin(t);
    const pt = await platformToken(t);
    acme = await provisionTenant(t, pt, 'acme');
    globex = await provisionTenant(t, pt, 'globex');
    mgr = await addMember(t, acme, 'mgr@acme.test');
    alice = await addMember(t, acme, 'alice@acme.test');
    bob = await addMember(t, acme, 'bob@acme.test');
    carol = await addMember(t, acme, 'carol@acme.test');
    eng = await orgUnit(t, acme, { code: 'ENG', managerUserId: mgr.userId });
    backend = await orgUnit(t, acme, { code: 'BE', parentId: eng });
    sales = await orgUnit(t, acme, { code: 'SAL' });
    await joinUnit(t, acme, backend, alice.userId);
    await joinUnit(t, acme, eng, bob.userId);
    await joinUnit(t, acme, sales, carol.userId);
    // a team lead: kartabl and tasks over their own unit and below
    await grantRole(t, acme, mgr.userId, 'team_lead', [
      { key: 'core.task.assign', scope: 'org_unit' },
      { key: 'core.inbox.assign', scope: 'org_unit' },
    ]);
  });
  afterAll(() => t.close());

  describe('org units', () => {
    it('keeps the tree: depth, the manager as a member, and paths the database maintains', async () => {
      const units = (await t.request('GET', '/api/v1/core/org-units', { token: acme.ownerToken })).body;
      const byCode = Object.fromEntries(units.map((u: { code: string }) => [u.code, u]));
      expect(byCode.ENG).toMatchObject({ depth: 0, managerUserId: mgr.userId, memberCount: 2, legalEntityId: acme.legalEntityId });
      expect(byCode.BE).toMatchObject({ depth: 1, parentId: eng, memberCount: 1 });
      const path = await t.owner.query(`select path::text from core.org_units where id = $1`, [backend]);
      expect(path.rows[0].path).toBe(`${eng.replaceAll('-', '')}.${backend.replaceAll('-', '')}`);
    });

    it('moves a unit with its sub-units, and refuses to move one under itself', async () => {
      const team = await orgUnit(t, acme, { code: 'TMP', parentId: backend });
      const moved = await t.request('PATCH', `/api/v1/core/org-units/${backend}`, { token: acme.ownerToken, body: { parentId: sales } });
      expect(moved.status).toBe(200);
      const path = await t.owner.query(`select path::text from core.org_units where id = $1`, [team]);
      expect(path.rows[0].path.startsWith(sales.replaceAll('-', ''))).toBe(true);
      const cycle = await t.request('PATCH', `/api/v1/core/org-units/${backend}`, { token: acme.ownerToken, body: { parentId: team } });
      expect(cycle.status).toBe(409);
      expect(cycle.body.code).toBe('ORG_UNIT_CYCLE');
      await t.request('PATCH', `/api/v1/core/org-units/${backend}`, { token: acme.ownerToken, body: { parentId: eng } });
      const busy = await t.request('DELETE', `/api/v1/core/org-units/${backend}`, { token: acme.ownerToken });
      expect(busy.body.code).toBe('ORG_UNIT_HAS_CHILDREN');
      expect((await t.request('DELETE', `/api/v1/core/org-units/${team}`, { token: acme.ownerToken })).status).toBe(204);
    });

    it('lets members read the chart but not change it, and keeps tenants apart', async () => {
      expect((await t.request('GET', '/api/v1/core/org-units', { token: alice.token })).status).toBe(200);
      const denied = await t.request('POST', '/api/v1/core/org-units', { token: alice.token, body: { code: 'X', name: 'X' } });
      expect(denied.status).toBe(403);
      expect((await t.request('GET', '/api/v1/core/org-units', { token: globex.ownerToken })).body).toEqual([]);
      const foreign = await t.request('PUT', `/api/v1/core/org-units/${eng}/members/${globex.ownerId}`, { token: globex.ownerToken, body: {} });
      expect(foreign.status).toBe(404);
    });
  });

  describe('work tasks (میز کار)', () => {
    let taskId: string;

    it('lets a team lead send tasks inside their unit only', async () => {
      const ok = await t.request('POST', '/api/v1/core/tasks', {
        token: mgr.token,
        body: { to: { orgUnitId: eng, includeSubUnits: true }, title: 'Prepare the panel BOM', priority: 'urgent', dueDate: '2026-12-01' },
      });
      expect(ok.status).toBe(201);
      expect(ok.body.assignees.map((a: { userId: string }) => a.userId).sort()).toEqual([alice.userId, bob.userId, mgr.userId].sort());
      taskId = ok.body.id;
      const out = await t.request('POST', '/api/v1/core/tasks', { token: mgr.token, body: { to: { userIds: [carol.userId] }, title: 'Not yours' } });
      expect(out.status).toBe(403);
      expect(out.body.code).toBe('OUT_OF_SCOPE');
      const plain = await t.request('POST', '/api/v1/core/tasks', { token: alice.token, body: { to: { userIds: [bob.userId] }, title: 'No right' } });
      expect(plain.status).toBe(403);
    });

    it('a role in another unit’s context reaches that unit', async () => {
      await grantRole(t, acme, mgr.userId, 'sales_tasks', [{ key: 'core.task.assign', scope: 'org_unit' }], { type: 'org_unit', id: sales });
      const r = await t.request('POST', '/api/v1/core/tasks', { token: mgr.token, body: { to: { userIds: [carol.userId] }, title: 'Visit the client' } });
      expect(r.status).toBe(201);
    });

    it('assignees report progress, confirm receipt and hand work on; only the creator deletes', async () => {
      const ack = await t.request('POST', `/api/v1/core/tasks/${taskId}/acknowledge`, { token: alice.token });
      expect(ack.body.assignees.find((a: { userId: string }) => a.userId === alice.userId).acknowledgedAt).not.toBeNull();
      const st = await t.request('POST', `/api/v1/core/tasks/${taskId}/status`, { token: alice.token, body: { status: 'in_progress' } });
      expect(st.status).toBe(200);
      expect((await t.request('POST', `/api/v1/core/tasks/${taskId}/status`, { token: carol.token, body: { status: 'done' } })).status).toBe(404);

      const handed = await t.request('POST', `/api/v1/core/tasks/${taskId}/delegate`, { token: alice.token, body: { toUserId: carol.userId } });
      const carolsShare = handed.body.assignees.find((a: { userId: string }) => a.userId === carol.userId);
      expect(carolsShare).toMatchObject({ status: 'open', delegatedFrom: alice.userId, acknowledgedAt: null });
      expect((await t.request('GET', '/api/v1/core/tasks', { token: alice.token })).body.some((x: { id: string }) => x.id === taskId)).toBe(false);
      expect((await t.request('GET', '/api/v1/core/tasks', { token: carol.token })).body.some((x: { id: string }) => x.id === taskId)).toBe(true);

      expect((await t.request('DELETE', `/api/v1/core/tasks/${taskId}`, { token: carol.token })).body.code).toBe('NOT_TASK_CREATOR');
      expect((await t.request('DELETE', `/api/v1/core/tasks/${taskId}`, { token: mgr.token })).status).toBe(204);
    });
  });

  describe('kartabl', () => {
    it('keeps what a manager assigned tamper-proof for the assignee (Kara accountability rule)', async () => {
      const item = await t.request('POST', '/api/v1/core/kartabl/items', {
        token: mgr.token,
        body: { ownerUserId: alice.userId, title: 'Check the busbar calculation' },
      });
      expect(item.status).toBe(201);
      const edit = await t.request('PATCH', `/api/v1/core/kartabl/items/${item.body.id}`, { token: alice.token, body: { title: 'Nothing to do' } });
      expect(edit.status).toBe(403);
      expect(edit.body.code).toBe('ASSIGNED_ITEM_LOCKED');
      expect((await t.request('DELETE', `/api/v1/core/kartabl/items/${item.body.id}`, { token: alice.token })).status).toBe(403);
      const done = await t.request('POST', `/api/v1/core/kartabl/items/${item.body.id}/status`, { token: alice.token, body: { status: 'done' } });
      expect(done.body.status).toBe('done');
      expect((await t.request('PATCH', `/api/v1/core/kartabl/items/${item.body.id}`, { token: mgr.token, body: { title: 'Re-check' } })).status).toBe(200);
    });

    it('lets people keep their own notes, and refuses others’ kartabls without scope', async () => {
      const note = await t.request('POST', '/api/v1/core/kartabl/items', { token: alice.token, body: { kind: 'note', title: 'Mine' } });
      expect((await t.request('PATCH', `/api/v1/core/kartabl/items/${note.body.id}`, { token: alice.token, body: { title: 'Mine, edited' } })).status).toBe(200);
      const intoCarols = await t.request('POST', '/api/v1/core/kartabl/items', { token: alice.token, body: { ownerUserId: carol.userId, title: 'x' } });
      expect(intoCarols.status).toBe(403);
      expect((await t.request('GET', `/api/v1/core/kartabl?ownerUserId=${alice.userId}`, { token: carol.token })).status).toBe(403);
      const own = await t.request('GET', '/api/v1/core/kartabl', { token: alice.token });
      expect(own.body.items.map((i: { title: string }) => i.title)).toEqual(expect.arrayContaining(['Mine, edited', 'Re-check']));
      expect(own.body.approvals).toEqual([]);
    });

    it('sends a message to a whole unit, sub-units included', async () => {
      const r = await t.request('POST', '/api/v1/core/kartabl/messages', {
        token: mgr.token,
        body: { to: { orgUnitId: eng, includeSubUnits: true }, title: 'Safety meeting on Saturday' },
      });
      expect(r.body).toEqual({ delivered: 2 }); // alice and bob; not the sender
      const bobs = await t.request('GET', '/api/v1/core/kartabl', { token: bob.token });
      expect(bobs.body.items[0]).toMatchObject({ kind: 'message', title: 'Safety meeting on Saturday', createdBy: mgr.userId });
      const events = await t.owner.query(`select count(*)::int n from core.outbox_events where type = 'core.inbox_item.created'`);
      expect(events.rows[0].n).toBeGreaterThan(0);
    });
  });

  describe('work calendar', () => {
    it('starts every tenant with a default schedule and the official holidays', async () => {
      const schedules = (await t.request('GET', '/api/v1/core/calendar/schedules', { token: alice.token })).body;
      expect(schedules).toHaveLength(1);
      expect(schedules[0]).toMatchObject({ isDefault: true, workDays: [0, 1, 2, 3, 4] });
      const count = await t.owner.query(`select count(*)::int n from core.holidays where tenant_id = $1`, [acme.id]);
      expect(count.rows[0].n).toBeGreaterThanOrEqual(48); // two Jalali years
    });

    it('imports a year’s official holidays once, and lets HR add company days off', async () => {
      const first = await t.request('POST', '/api/v1/core/calendar/holidays/import-official', { token: acme.ownerToken, body: { jalaliYear: 1410 } });
      expect(first.body.added).toBeGreaterThanOrEqual(24);
      const again = await t.request('POST', '/api/v1/core/calendar/holidays/import-official', { token: acme.ownerToken, body: { jalaliYear: 1410 } });
      expect(again.body.added).toBe(0);
      const nowruz = await t.request('GET', '/api/v1/core/calendar/holidays?from=2031-03-21&to=2031-03-24', { token: alice.token });
      expect(nowruz.body.map((h: { holidayDate: string }) => h.holidayDate)).toEqual(['2031-03-21', '2031-03-22', '2031-03-23', '2031-03-24']);
      const denied = await t.request('POST', '/api/v1/core/calendar/holidays', { token: alice.token, body: { date: '2031-05-01', title: 'x' } });
      expect(denied.status).toBe(403);
      const bridge = await t.request('PUT', '/api/v1/core/calendar/overrides', { token: acme.ownerToken, body: { date: '2031-05-01', isWorking: false, note: 'bridge day' } });
      expect(bridge.status).toBe(200);
    });

    it('keeps one default schedule', async () => {
      const r = await t.request('POST', '/api/v1/core/calendar/schedules', {
        token: acme.ownerToken,
        body: { name: 'Factory', workDays: [0, 1, 2, 3, 4, 5], startTime: '07:00', endTime: '15:20', isDefault: true },
      });
      expect(r.status).toBe(201);
      const all = (await t.request('GET', '/api/v1/core/calendar/schedules', { token: alice.token })).body;
      expect(all.filter((s: { isDefault: boolean }) => s.isDefault).map((s: { name: string }) => s.name)).toEqual(['Factory']);
    });
  });

  it('every new table is tenant-isolated by RLS', async () => {
    await t.owner.query('select core.assert_rls()');
  });
});
