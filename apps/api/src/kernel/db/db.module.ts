import { Global, Inject, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { createDb, createPool, inPlatform, inTenant, type Db, type Tx } from '@simorgh/db';
import type pg from 'pg';
import { CONFIG, type Config } from '../../config.js';
import type { RequestContext } from '../http/context.js';

export const PG_POOL = Symbol('PG_POOL');

/**
 * The single way request code reaches the database: a transaction scoped to
 * the caller's tenant (RLS) or, for platform routes, to no tenant at all.
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  readonly db: Db;

  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {
    this.db = createDb(pool);
  }

  /** Transaction inside `tenantId` (defaults to the caller's tenant). */
  tenant<T>(ctx: Pick<RequestContext, 'tenantId' | 'userId'>, fn: (tx: Tx) => Promise<T>, tenantId?: string): Promise<T> {
    const tid = tenantId ?? ctx.tenantId;
    if (!tid) throw new Error('tenant transaction requested without a tenant');
    return inTenant(this.db, { tenantId: tid, userId: ctx.userId }, fn);
  }

  /** Transaction with no tenant: platform tables only. */
  platform<T>(userId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return inPlatform(this.db, userId, fn);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    { provide: PG_POOL, inject: [CONFIG], useFactory: (c: Config) => createPool(c.DATABASE_URL) },
    DbService,
  ],
  exports: [DbService],
})
export class DbModule {}
