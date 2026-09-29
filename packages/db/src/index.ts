import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export * from './schema.js';
export { schema };

export type Db = NodePgDatabase<typeof schema>;
/** A transaction handle; everything the kernel writes goes through one. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export function createPool(connectionString: string, max = 10): pg.Pool {
  return new pg.Pool({ connectionString, max });
}

export function createDb(pool: pg.Pool): Db {
  return drizzle(pool, { schema });
}

export interface TenantScope {
  tenantId: string;
  userId?: string | null;
}

/**
 * Runs `fn` in a transaction whose row-level security is scoped to one tenant.
 *
 * `set_config(..., true)` is transaction-local, so the setting can never leak
 * to the next request that borrows the same pooled connection — the same
 * reasoning as Kara's `SET LOCAL search_path`, applied to `app.tenant_id`.
 */
export function inTenant<T>(db: Db, scope: TenantScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.tenant_id', ${scope.tenantId}, true), set_config('app.user_id', ${scope.userId ?? ''}, true)`,
    );
    return fn(tx);
  });
}

/**
 * Runs `fn` in a transaction with no tenant: tenant tables are invisible (RLS
 * matches nothing) and only platform tables (tenants, users, sessions) are usable.
 */
export function inPlatform<T>(db: Db, userId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId ?? ''}, true)`);
    return fn(tx);
  });
}

/** Switches an open transaction into a tenant (used when provisioning a new tenant). */
export async function enterTenant(tx: Tx, tenantId: string): Promise<void> {
  await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
}
