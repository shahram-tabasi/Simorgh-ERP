import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/** The migrations shipped with this package. */
export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
/** Cluster-level roles; run once per cluster before the first migration. */
export const ROLES_SQL = join(dirname(fileURLToPath(import.meta.url)), '..', 'sql', 'roles.sql');

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

// Arbitrary but fixed: serialises concurrent migrators (two API replicas starting together).
const LOCK_KEY = 7_411_503_901;

/**
 * Applies every `NNNN_name.sql` in `dir` that has not been applied yet, each in
 * its own transaction, in file-name order. Must run as the schema owner.
 *
 * An applied migration whose file has changed since is an error, not a no-op:
 * migrations are append-only, a fix is a new file.
 */
export async function migrate(connectionString: string, dir = MIGRATIONS_DIR): Promise<MigrationResult> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  const result: MigrationResult = { applied: [], skipped: [] };
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.simorgh_migrations (
        version    text PRIMARY KEY,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const done = new Map<string, string>(
      (await client.query<{ version: string; checksum: string }>('SELECT version, checksum FROM public.simorgh_migrations'))
        .rows.map((r) => [r.version, r.checksum]),
    );
    const files = (await readdir(dir)).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
    for (const file of files) {
      const sql = await readFile(join(dir, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const version = file.replace(/\.sql$/, '');
      const previous = done.get(version);
      if (previous !== undefined) {
        if (previous !== checksum) {
          throw new Error(`migration ${file} was changed after it was applied; add a new migration instead`);
        }
        result.skipped.push(version);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO public.simorgh_migrations (version, checksum) VALUES ($1, $2)', [
          version,
          checksum,
        ]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${file} failed: ${(err as Error).message}`, { cause: err });
      }
      result.applied.push(version);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    await client.end();
  }
  return result;
}

/** Creates the cluster roles (idempotent). Needs CREATEROLE. */
export async function ensureRoles(connectionString: string): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(await readFile(ROLES_SQL, 'utf8'));
  } finally {
    await client.end();
  }
}
