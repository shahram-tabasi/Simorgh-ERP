import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { DecideTaskRequest } from '@simorgh/contracts';
import { z } from 'zod';
import { DbService } from '../db/db.module.js';
import { TenantCtx, type TenantContext } from '../http/context.js';
import { Authenticated } from '../rbac/permission.guard.js';
import { WorkflowEngine } from './workflow.engine.js';

const Id = z.uuid();

/**
 * Approvals are open to every member: whether you may decide a task is the
 * workflow's question (you were assigned it and are still eligible), not a
 * route permission.
 */
@Controller('api/v1/core/workflow')
export class WorkflowController {
  constructor(
    private readonly engine: WorkflowEngine,
    private readonly db: DbService,
  ) {}

  @Get('approvals')
  @Authenticated()
  approvals(@TenantCtx() ctx: TenantContext) {
    return this.db.tenant(ctx, (tx) => this.engine.myApprovals(tx, ctx.userId));
  }

  @Post('tasks/:id/decision')
  @HttpCode(200)
  @Authenticated()
  decide(
    @TenantCtx() ctx: TenantContext,
    @Param('id', { schema: Id }) id: string,
    @Body({ schema: DecideTaskRequest }) body: DecideTaskRequest,
  ) {
    return this.engine.decide(ctx, id, body.decision, body.comment ?? null);
  }

  @Get('instances/:id')
  @Authenticated()
  instance(@TenantCtx() ctx: TenantContext, @Param('id', { schema: Id }) id: string) {
    return this.engine.view(ctx, id);
  }
}
