import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './harness.js';

// Database-level guarantees, checked with the real roles the services use.
describe('row-level security and database roles', () => {
  let db: TestDb;
  let owner: pg.Pool;
  let app: pg.Pool;
  let worker: pg.Pool;
  const A = '00000000-0000-0000-0000-00000000000a';
  const B = '00000000-0000-0000-0000-00000000000b';

  async function asTenant<T>(tenant: string | null, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      if (tenant) await c.query(`select set_config('app.tenant_id', $1, true)`, [tenant]);
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }

  beforeAll(async () => {
    db = await createTestDb();
    owner = new pg.Pool({ connectionString: db.ownerUrl });
    app = new pg.Pool({ connectionString: db.appUrl });
    worker = new pg.Pool({ connectionString: db.workerUrl });
    await owner.query(`INSERT INTO core.tenants (id, code, name) VALUES ($1,'ta','A'), ($2,'tb','B')`, [A, B]);
    for (const t of [A, B]) {
      await owner.query(`INSERT INTO core.parties (tenant_id, kind, code, display_name) VALUES ($1,'organization','P1','party')`, [t]);
      await owner.query(
        `INSERT INTO core.outbox_events (tenant_id, type, subject_type, subject_id, payload) VALUES ($1,'x.y.z','x.y',core.uuid_v7(),'{}')`,
        [t],
      );
    }
  });

  afterAll(async () => {
    await Promise.all([owner.end(), app.end(), worker.end()]);
    await db.drop();
  });

  it('every tenant-scoped table has forced RLS and a policy', async () => {
    await expect(owner.query('select core.assert_rls()')).resolves.toBeDefined();
  });

  it('a tenant sees only its own rows', async () => {
    const a = await asTenant(A, (c) => c.query('select tenant_id from core.parties'));
    expect(a.rows.map((r) => r.tenant_id)).toEqual([A]);
  });

  it('no tenant set means no tenant rows at all', async () => {
    const r = await asTenant(null, (c) => c.query('select count(*)::int n from core.parties'));
    expect(r.rows[0].n).toBe(0);
  });

  it('a tenant cannot write a row into another tenant', async () => {
    await expect(
      asTenant(A, (c) =>
        c.query(`INSERT INTO core.parties (tenant_id, kind, code, display_name) VALUES ($1,'person','X','x')`, [B]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('a tenant cannot move its row to another tenant', async () => {
    await expect(asTenant(A, (c) => c.query(`UPDATE core.parties SET tenant_id = $1`, [B]))).rejects.toThrow(
      /row-level security/,
    );
  });

  it('the app role cannot publish outbox rows (the relay owns publication)', async () => {
    await expect(asTenant(A, (c) => c.query(`UPDATE core.outbox_events SET published_at = now()`))).rejects.toThrow(
      /permission denied/,
    );
  });

  it('the worker reads every tenant’s outbox but nothing else', async () => {
    const r = await worker.query('select count(*)::int n from core.outbox_events');
    expect(r.rows[0].n).toBe(2);
    await expect(worker.query('select * from core.parties')).rejects.toThrow(/permission denied/);
    await expect(worker.query('select * from core.users')).rejects.toThrow(/permission denied/);
  });

  it('audit rows of the platform are invisible to tenants', async () => {
    await asTenant(null, (c) => c.query(`INSERT INTO core.audit_log (action, entity_type) VALUES ('p','x')`));
    await asTenant(A, (c) => c.query(`INSERT INTO core.audit_log (tenant_id, action, entity_type) VALUES ($1,'t','x')`, [A]));
    const seenByA = await asTenant(A, (c) => c.query('select action from core.audit_log'));
    expect(seenByA.rows.map((r) => r.action)).toEqual(['t']);
    const seenByPlatform = await asTenant(null, (c) => c.query('select action from core.audit_log'));
    expect(seenByPlatform.rows.map((r) => r.action)).toEqual(['p']);
  });

  it('migrations refuse to run a changed file twice', async () => {
    const { migrate } = await import('@simorgh/db/migrate');
    const again = await migrate(db.ownerUrl);
    expect(again.applied).toEqual([]);
    expect(again.skipped).toContain('0001_kernel');
  });
});
