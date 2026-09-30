import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { CORE_PERMISSIONS, CreateTaskRequest, DelegateTaskRequest, SetTaskStatusRequest } from '@simorgh/contracts';
import { z } from 'zod';
import { TenantCtx, type TenantContext } from '../http/context.js';
import { Authenticated, RequirePermission } from '../rbac/permission.guard.js';
import { TasksService } from './tasks.service.js';

const Id = z.uuid();
const ListQuery = z.object({ box: z.enum(['inbox', 'sent']).default('inbox') });

@Controller('api/v1/core/tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @Authenticated()
  list(@TenantCtx() ctx: TenantContext, @Query({ schema: ListQuery }) q: z.infer<typeof ListQuery>) {
    return this.tasks.list(ctx, q.box);
  }

  @Post()
  @RequirePermission(CORE_PERMISSIONS['task.assign'])
  create(@TenantCtx() ctx: TenantContext, @Body({ schema: CreateTaskRequest }) body: CreateTaskRequest) {
    return this.tasks.create(ctx, body);
  }

  @Post(':id/status')
  @HttpCode(200)
  @Authenticated()
  setStatus(
    @TenantCtx() ctx: TenantContext,
    @Param('id', { schema: Id }) id: string,
    @Body({ schema: SetTaskStatusRequest }) body: z.infer<typeof SetTaskStatusRequest>,
  ) {
    return this.tasks.setStatus(ctx, id, body.status);
  }

  @Post(':id/acknowledge')
  @HttpCode(200)
  @Authenticated()
  acknowledge(@TenantCtx() ctx: TenantContext, @Param('id', { schema: Id }) id: string) {
    return this.tasks.acknowledge(ctx, id);
  }

  @Post(':id/delegate')
  @HttpCode(200)
  @Authenticated()
  delegate(
    @TenantCtx() ctx: TenantContext,
    @Param('id', { schema: Id }) id: string,
    @Body({ schema: DelegateTaskRequest }) body: z.infer<typeof DelegateTaskRequest>,
  ) {
    return this.tasks.delegate(ctx, id, body.toUserId);
  }

  @Delete(':id')
  @HttpCode(204)
  @Authenticated()
  remove(@TenantCtx() ctx: TenantContext, @Param('id', { schema: Id }) id: string) {
    return this.tasks.remove(ctx, id);
  }
}
