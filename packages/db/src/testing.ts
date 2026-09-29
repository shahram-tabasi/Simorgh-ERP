import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { ensureRoles, migrate } from './migrate.js';

/**
 * Every test file gets its own freshly migrated database on a real
 * PostgreSQL — RLS, triggers and grants are the thing under test, so no mocks.
 *
 * DATABASE_URL_OWNER  superuser/owner connection to the cluster (any database)
 * APP_DB_PASSWORD     password set on simorgh_app    (default app-test)
 * WORKER_DB_PASSWORD  password set on simorgh_worker (default worker-test)
 */
const OWNER_URL = process.env.DATABASE_URL_OWNER ?? 'postgres://postgres@localhost:55432/postgres';
const APP_PASSWORD = process.env.APP_DB_PASSWORD ?? 'app-test';
const WORKER_PASSWORD = process.env.WORKER_DB_PASSWORD ?? 'worker-test';

export interface TestDb {
  name: string;
  ownerUrl: string;
  appUrl: string;
  workerUrl: string;
  drop(): Promise<void>;
}

function withDatabase(url: string, db: string, user?: string, password?: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  if (user) {
    u.username = user;
    u.password = password ?? '';
  }
  return u.toString();
}

export async function createTestDb(): Promise<TestDb> {
  const name = `simorgh_test_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: OWNER_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const ownerUrl = withDatabase(OWNER_URL, name);
  await ensureRoles(ownerUrl);
  const c = new pg.Client({ connectionString: ownerUrl });
  await c.connect();
  await c.query(`ALTER ROLE simorgh_app PASSWORD '${APP_PASSWORD}'`);
  await c.query(`ALTER ROLE simorgh_worker PASSWORD '${WORKER_PASSWORD}'`);
  await c.end();
  await migrate(ownerUrl);

  return {
    name,
    ownerUrl,
    appUrl: withDatabase(OWNER_URL, name, 'simorgh_app', APP_PASSWORD),
    workerUrl: withDatabase(OWNER_URL, name, 'simorgh_worker', WORKER_PASSWORD),
    async drop() {
      const a = new pg.Client({ connectionString: OWNER_URL });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await a.end();
    },
  };
}

