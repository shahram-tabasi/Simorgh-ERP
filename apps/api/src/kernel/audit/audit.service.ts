import { Injectable } from '@nestjs/common';
import { auditLog, type Tx } from '@simorgh/db';
import { sql } from 'drizzle-orm';
import type { RequestContext } from '../http/context.js';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

/**
 * Writes the audit trail inside the caller's transaction, so an action and its
 * record commit or roll back together. The row's tenant is whatever tenant the
 * transaction is in (NULL in a platform transaction), never a parameter: a
 * caller cannot file an entry under someone else's tenant.
 */
@Injectable()
export class AuditService {
  async record(tx: Tx, ctx: Partial<RequestContext> | null, entry: AuditEntry): Promise<void> {
    await tx.insert(auditLog).values({
      tenantId: sql`core.current_tenant()`,
      actorUserId: ctx?.userId ?? null,
      actorVia: ctx?.via ?? 'system',
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      ipAddress: ctx?.ip ?? null,
      correlationId: ctx?.correlationId ?? null,
    });
  }
}
