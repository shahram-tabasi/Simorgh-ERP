import { Controller, Get, Query } from '@nestjs/common';
import { CORE_PERMISSIONS } from '@simorgh/contracts';
import { auditLog } from '@simorgh/db';
import { and, desc, eq, lt } from 'drizzle-orm';
import { z } from 'zod';
import { DbService } from '../db/db.module.js';
import { TenantCtx, type TenantContext } from '../http/context.js';
import { RequirePermission } from '../rbac/permission.guard.js';

const AuditQuery = z.object({
  entityType: z.string().max(100).optional(),
  entityId: z.uuid().optional(),
  before: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

@Controller('api/v1/core/audit')
export class AuditController {
  constructor(private readonly db: DbService) {}

  @Get()
  @RequirePermission(CORE_PERMISSIONS['audit.view'])
  list(@TenantCtx() ctx: TenantContext, @Query({ schema: AuditQuery }) q: z.infer<typeof AuditQuery>) {
    return this.db.tenant(ctx, (tx) =>
      tx
        .select()
        .from(auditLog)
        .where(
          and(
            q.entityType ? eq(auditLog.entityType, q.entityType) : undefined,
            q.entityId ? eq(auditLog.entityId, q.entityId) : undefined,
            q.before ? lt(auditLog.at, new Date(q.before)) : undefined,
          ),
        )
        .orderBy(desc(auditLog.at))
        .limit(q.limit),
    );
  }
}
