import { addDays, iranianWeekday, todayIso } from '@simorgh/jalali';
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

describe('HCM leave through the workflow engine (Kara → ERP)', () => {
  let t: TestApp;
  let co: TenantFixture;
  let mgr: Person, emp: Person, emp2: Person, hr: Person;
  let eng: string;
  let offDays: Set<string>;
  let types: Record<string, string>;
  let cursor: string; // runs are handed out in order, so no two tests' leave overlaps

  /** The next `n` consecutive working days (no Friday, no holiday) after the cursor. */
  const workingRun = (n: number): { from: string; to: string } => {
    for (let d = addDays(cursor, 1); ; d = addDays(d, 1)) {
      const days = Array.from({ length: n }, (_, i) => addDays(d, i));
      if (days.every((x) => iranianWeekday(x) !== 6 && !offDays.has(x))) {
        cursor = days[n - 1]!;
        return { from: days[0]!, to: days[n - 1]! };
      }
    }
  };

  const submit = (who: Person, body: Record<string, unknown>) => t.request('POST', '/api/v1/hcm/leave/requests', { token: who.token, body });
  const approvals = async (who: Person) => (await t.request('GET', '/api/v1/core/workflow/approvals', { token: who.token })).body as { taskId: string; docId: string; stepLabel: string }[];
  const decide = (who: Person, taskId: string, decision: 'approve' | 'reject', comment?: string) =>
    t.request('POST', `/api/v1/core/workflow/tasks/${taskId}/decision`, { token: who.token, body: { decision, comment } });
  const taskFor = async (who: Person, docId: string) => (await approvals(who)).find((a) => a.docId === docId);

  beforeAll(async () => {
    t = await createTestApp();
    await seedPlatformAdmin(t);
    co = await provisionTenant(t, await platformToken(t), 'ekc');
    mgr = await addMember(t, co, 'mgr@ekc.test');
    emp = await addMember(t, co, 'emp@ekc.test');
    emp2 = await addMember(t, co, 'emp2@ekc.test');
    hr = await addMember(t, co, 'hr@ekc.test');
    eng = await orgUnit(t, co, { code: 'ENG', managerUserId: mgr.userId });
    const backend = await orgUnit(t, co, { code: 'BE', parentId: eng });
    await joinUnit(t, co, backend, emp.userId);
    await joinUnit(t, co, backend, emp2.userId);
    await grantRole(t, co, hr.userId, 'hr_officer', [
      { key: 'hcm.leave.approve.hr', scope: 'tenant' },
      { key: 'hcm.leave.view', scope: 'tenant' },
      { key: 'hcm.leave_ledger.manage', scope: 'tenant' },
      { key: 'hcm.employment.manage', scope: 'tenant' },
    ]);
    const today = todayIso();
    const hol = await t.request('GET', `/api/v1/core/calendar/holidays?from=${today}&to=${addDays(today, 400)}`, { token: emp.token });
    offDays = new Set(hol.body.filter((h: { isOff: boolean }) => h.isOff).map((h: { holidayDate: string }) => h.holidayDate));
    cursor = addDays(today, 7);
    types = Object.fromEntries((await t.request('GET', '/api/v1/hcm/leave/types', { token: emp.token })).body.map((x: { code: string; id: string }) => [x.code, x.id]));
    const fiveYearsAgo = addDays(today, -5 * 365);
    for (const [who, hireDate] of [[emp, fiveYearsAgo], [emp2, today]] as const) {
      const r = await t.request('PUT', `/api/v1/hcm/employment/${who.userId}`, { token: hr.token, body: { hireDate, site: 'factory' } });
      expect(r.status).toBe(200);
    }
  });
  afterAll(() => t.close());

  it('seeds Kara’s twelve leave types for the company', () => {
    expect(Object.keys(types)).toHaveLength(12);
    expect(types).toHaveProperty('entitlement_daily');
    expect(types).toHaveProperty('exit_permit');
  });

  it('routes a leave to the unit manager, then HR, and records it as used', async () => {
    const run = workingRun(2);
    const r = await submit(emp, { typeId: types.entitlement_daily, fromDate: run.from, toDate: run.to, reason: 'family' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'pending', effectiveDays: 2, kind: 'leave' });

    expect(await taskFor(hr, r.body.id)).toBeUndefined(); // HR only after the manager
    expect(await taskFor({ userId: co.ownerId, token: co.ownerToken }, r.body.id)).toBeUndefined(); // admins are only the fallback
    const first = await taskFor(mgr, r.body.id);
    expect(first).toMatchObject({ stepLabel: 'مدیر بخش' });
    expect((await decide(emp, first!.taskId, 'approve')).status).toBe(404); // nobody approves their own leave
    expect((await t.request('GET', `/api/v1/hcm/leave/requests/${r.body.id}`, { token: mgr.token })).status).toBe(200);

    expect((await decide(mgr, first!.taskId, 'approve')).status).toBe(200);
    const second = await taskFor(hr, r.body.id);
    expect(second).toMatchObject({ stepLabel: 'کارگزینی' });
    const done = await decide(hr, second!.taskId, 'approve', 'ok');
    expect(done.body.status).toBe('approved');
    expect(done.body.history.map((h: { action: string }) => h.action)).toEqual(['start', 'activate', 'approve', 'activate', 'approve', 'complete']);

    const after = await t.request('GET', `/api/v1/hcm/leave/requests/${r.body.id}`, { token: emp.token });
    expect(after.body).toMatchObject({ status: 'approved', decidedBy: hr.userId });
    const balance = await t.request('GET', '/api/v1/hcm/leave/balance', { token: emp.token });
    expect(balance.body).toMatchObject({ used: 2, pending: 0, dailyWorkMinutes: 440 });
    const ev = await t.owner.query(`select count(*)::int n from core.outbox_events where type = 'hcm.leave.approved' and subject_id = $1`, [r.body.id]);
    expect(ev.rows[0].n).toBe(1);
  });

  it('ends at the first rejection', async () => {
    const run = workingRun(1);
    const r = await submit(emp, { typeId: types.entitlement_daily, fromDate: run.from });
    const task = await taskFor(mgr, r.body.id);
    const done = await decide(mgr, task!.taskId, 'reject', 'deadline week');
    expect(done.body).toMatchObject({ status: 'rejected', outcomeComment: 'deadline week' });
    expect(await taskFor(hr, r.body.id)).toBeUndefined();
    expect((await t.request('GET', `/api/v1/hcm/leave/requests/${r.body.id}`, { token: emp.token })).body.status).toBe('rejected');
  });

  it('lets the requester withdraw a pending request, which leaves the approvers’ kartabl', async () => {
    const run = workingRun(1);
    const r = await submit(emp, { typeId: types.entitlement_daily, fromDate: run.from });
    const task = await taskFor(mgr, r.body.id);
    const c = await t.request('POST', `/api/v1/hcm/leave/requests/${r.body.id}/cancel`, { token: emp.token });
    expect(c.body.status).toBe('cancelled');
    expect(await taskFor(mgr, r.body.id)).toBeUndefined();
    expect((await decide(mgr, task!.taskId, 'approve')).body.code).toBe('TASK_CLOSED');
    expect((await t.request('POST', `/api/v1/hcm/leave/requests/${r.body.id}/cancel`, { token: emp.token })).status).toBe(409);
  });

  it('does not bill Fridays and holidays inside day leave, unless the type counts them; refuses overlaps', async () => {
    // a Thursday–Saturday stretch with no holiday
    let thu = cursor;
    while (iranianWeekday(thu) !== 5 || [thu, addDays(thu, 1), addDays(thu, 2)].some((d) => offDays.has(d))) thu = addDays(thu, 1);
    cursor = addDays(thu, 2);
    const range = { fromDate: thu, toDate: addDays(thu, 2) };
    const paid = await submit(emp, { typeId: types.entitlement_daily, ...range });
    expect(paid.body.effectiveDays).toBe(2);
    const clash = await submit(emp, { typeId: types.unpaid, ...range });
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe('LEAVE_OVERLAP');
    await t.request('POST', `/api/v1/hcm/leave/requests/${paid.body.id}/cancel`, { token: emp.token });
    const unpaid = await submit(emp, { typeId: types.unpaid, ...range });
    expect(unpaid.body.effectiveDays).toBe(3);
    await t.request('POST', `/api/v1/hcm/leave/requests/${unpaid.body.id}/cancel`, { token: emp.token });
  });

  it('keeps the hourly ceilings: minutes per day and times per week', async () => {
    // three working days inside one Saturday–Friday week
    let sat = addDays(cursor, 1);
    while (iranianWeekday(sat) !== 0) sat = addDays(sat, 1);
    const week = Array.from({ length: 6 }, (_, i) => addDays(sat, i)).filter((d) => !offDays.has(d)).slice(0, 3);
    cursor = addDays(sat, 6);
    const exit = (date: string, fromTime: string, toTime: string) => submit(emp, { typeId: types.exit_permit, fromDate: date, fromTime, toTime });

    expect((await exit(week[0]!, '08:00', '08:11')).body.code).toBe('LEAVE_DAILY_CAP'); // 10 minutes a day
    const a = await exit(week[0]!, '08:00', '08:05');
    expect(a.status).toBe(201);
    expect(a.body.effectiveDays).toBe(0.01); // 5 of the factory's 440 minutes
    expect((await exit(week[0]!, '09:00', '09:06')).body.code).toBe('LEAVE_DAILY_CAP'); // 5 + 6 > 10 on the same day
    expect((await exit(week[0]!, '08:03', '08:04')).body.code).toBe('LEAVE_OVERLAP');
    expect((await exit(week[1]!, '08:00', '08:05')).status).toBe(201);
    let friday = week[0]!;
    while (iranianWeekday(friday) !== 6) friday = addDays(friday, 1);
    expect((await exit(friday, '08:00', '08:05')).body.code).toBe('NOT_A_WORKING_DAY');
    expect((await exit(week[2]!, '08:00', '08:05')).body.code).toBe('LEAVE_WEEKLY_CAP'); // twice a week
  });

  it('allows the entitlement to go at most three days below zero, counting pending requests', async () => {
    // emp2 was hired today: almost nothing accrued yet
    const five = workingRun(5);
    const tooMuch = await submit(emp2, { typeId: types.entitlement_daily, fromDate: five.from, toDate: five.to });
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.code).toBe('INSUFFICIENT_BALANCE');
    const three = workingRun(3);
    expect((await submit(emp2, { typeId: types.entitlement_daily, fromDate: three.from, toDate: three.to })).status).toBe(201);
    const one = workingRun(1);
    expect((await submit(emp2, { typeId: types.entitlement_daily, fromDate: one.from })).body.code).toBe('INSUFFICIENT_BALANCE');
    // unpaid leave is the way out
    expect((await submit(emp2, { typeId: types.unpaid, fromDate: one.from })).status).toBe(201);

    // HR carries days in from last year
    const add = await t.request('POST', '/api/v1/hcm/leave/ledger', {
      token: hr.token,
      body: { userId: emp2.userId, jalaliYear: (await t.request('GET', '/api/v1/hcm/leave/balance', { token: emp2.token })).body.jalaliYear, kind: 'carry_in', days: 5 },
    });
    expect(add.status).toBe(201);
    const b = (await t.request('GET', '/api/v1/hcm/leave/balance', { token: emp2.token })).body;
    expect(b).toMatchObject({ carriedIn: 5, pending: 3 });
    expect((await t.request('POST', '/api/v1/hcm/leave/ledger', { token: emp2.token, body: { userId: emp2.userId, jalaliYear: 1405, kind: 'adjust', days: 30 } })).status).toBe(403);
  });

  it('needs a document for sick leave and the route for a mission', async () => {
    const run = workingRun(1);
    expect((await submit(emp, { typeId: types.sick, fromDate: run.from })).body.code).toBe('ATTACHMENT_REQUIRED');
    expect((await submit(emp, { typeId: types.mission, fromDate: run.from })).body.code).toBe('MISSION_DETAILS_REQUIRED');
    const m = await submit(emp, { typeId: types.mission, fromDate: run.from, mission: { origin: 'تهران', destination: 'اصفهان', subject: 'FAT' } });
    expect(m.body).toMatchObject({ kind: 'mission', details: { origin: 'تهران', destination: 'اصفهان' } });
  });

  it('sends a manager’s own leave above them, and refuses what nobody could approve', async () => {
    const run = workingRun(1);
    const own = await submit(mgr, { typeId: types.incentive, fromDate: run.from });
    expect(own.status).toBe(201);
    expect(await taskFor(mgr, own.body.id)).toBeUndefined();
    // no unit above ENG and nobody else holds hcm.leave.approve: the administrators get it
    expect(await taskFor({ userId: co.ownerId, token: co.ownerToken }, own.body.id)).toBeDefined();

    const owner = await submit({ userId: co.ownerId, token: co.ownerToken }, { typeId: types.incentive, fromDate: run.from });
    expect(owner.status).toBe(409);
    expect(owner.body.code).toBe('WORKFLOW_NO_APPROVER');
  });

  it('re-checks eligibility when deciding: a manager replaced meanwhile cannot approve', async () => {
    const run = workingRun(1);
    const r = await submit(emp, { typeId: types.incentive, fromDate: run.from });
    const task = await taskFor(mgr, r.body.id);
    await t.request('PATCH', `/api/v1/core/org-units/${eng}`, { token: co.ownerToken, body: { managerUserId: null } });
    const late = await decide(mgr, task!.taskId, 'approve');
    expect(late.status).toBe(403);
    expect(late.body.code).toBe('NOT_ELIGIBLE');
    await t.request('PATCH', `/api/v1/core/org-units/${eng}`, { token: co.ownerToken, body: { managerUserId: mgr.userId } });
  });

  it('shows someone’s leave only to them, their approvers and hcm.leave.view within scope', async () => {
    const mine = (await t.request('GET', '/api/v1/hcm/leave/requests', { token: emp.token })).body;
    const id = mine[0].id;
    expect((await t.request('GET', `/api/v1/hcm/leave/requests/${id}`, { token: emp2.token })).status).toBe(404);
    expect((await t.request('GET', `/api/v1/hcm/leave/requests?userId=${emp.userId}`, { token: emp2.token })).status).toBe(403);
    expect((await t.request('GET', `/api/v1/hcm/leave/requests/${id}`, { token: hr.token })).status).toBe(200);
    const team = (await t.request('GET', '/api/v1/hcm/leave/requests?team=true', { token: hr.token })).body;
    expect(new Set(team.map((x: { userId: string }) => x.userId))).toEqual(new Set([emp.userId, emp2.userId, mgr.userId]));
    expect((await t.request('GET', '/api/v1/hcm/leave/requests?team=true', { token: emp.token })).body).toEqual([]);
    expect((await t.request('GET', `/api/v1/hcm/leave/balance?userId=${emp.userId}`, { token: hr.token })).status).toBe(200);
    expect((await t.request('GET', '/api/v1/hcm/leave/balances', { token: hr.token })).body.length).toBeGreaterThanOrEqual(4);
  });

  it('keeps the employment profile in HR’s hands, also for their own', async () => {
    const self = await t.request('PUT', `/api/v1/hcm/employment/${emp.userId}`, { token: emp.token, body: { hireDate: '2000-01-01' } });
    expect(self.status).toBe(403);
    const got = await t.request('GET', `/api/v1/hcm/employment/${emp.userId}`, { token: emp.token });
    expect(got.body).toMatchObject({ site: 'factory', dailyWorkMinutes: 440 });
  });

  it('keeps HCM tables tenant-isolated', async () => {
    await t.owner.query('select core.assert_rls()');
    const n = await t.owner.query(`select count(*)::int n from pg_policies where schemaname = 'hcm'`);
    expect(n.rows[0].n).toBe(5);
  });
});
