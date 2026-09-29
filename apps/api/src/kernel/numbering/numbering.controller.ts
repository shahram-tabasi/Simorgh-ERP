import { Body, Controller, Get, Post } from '@nestjs/common';
import { CORE_PERMISSIONS, CreateNumberSeriesRequest } from '@simorgh/contracts';
import { numberSeries } from '@simorgh/db';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { DbService } from '../db/db.module.js';
import { TenantCtx, type TenantContext } from '../http/context.js';
import { RequirePermission } from '../rbac/permission.guard.js';

@Controller('api/v1/core/number-series')
export class NumberingController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission(CORE_PERMISSIONS['number_series.manage'])
  list(@TenantCtx() ctx: TenantContext) {
    return this.db.tenant(ctx, (tx) => tx.select().from(numberSeries).orderBy(numberSeries.docType));
  }

  @Post()
  @RequirePermission(CORE_PERMISSIONS['number_series.manage'])
  create(@TenantCtx() ctx: TenantContext, @Body({ schema: CreateNumberSeriesRequest }) body: CreateNumberSeriesRequest) {
    return this.db.tenant(ctx, async (tx) => {
      const [row] = await tx
        .insert(numberSeries)
        .values({ tenantId: sql`core.current_tenant()`, ...body, legalEntityId: body.legalEntityId ?? null })
        .returning();
      await this.audit.record(tx, ctx, { action: 'core.number_series.create', entityType: 'core.number_series', entityId: row!.id, after: row });
      return row;
    });
  }
}
