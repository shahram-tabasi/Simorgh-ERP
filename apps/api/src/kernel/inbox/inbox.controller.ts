import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { CreateInboxItemRequest, SendMessageRequest, SetStatusRequest, UpdateInboxItemRequest } from '@simorgh/contracts';
import { z } from 'zod';
import { TenantCtx, type TenantContext } from '../http/context.js';
import { Authenticated } from '../rbac/permission.guard.js';
import { InboxService } from './inbox.service.js';

const Id = z.uuid();
const KartablQuery = z.object({ ownerUserId: z.uuid().optional(), includeArchived: z.stringbool().default(false) });

/** Every member has a kartabl; reaching someone else's is checked per item against scope. */
@Controller('api/v1/core/kartabl')
export class KartablController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  @Authenticated()
  list(@TenantCtx() ctx: TenantContext, @Query({ schema: KartablQuery }) q: z.infer<typeof KartablQuery>) {
    return this.inbox.list(ctx, q.ownerUserId, q.includeArchived);
  }

  @Post('items')
  @Authenticated()
  create(@TenantCtx() ctx: TenantContext, @Body({ schema: CreateInboxItemRequest }) body: CreateInboxItemRequest) {
    return this.inbox.create(ctx, body);
  }

  @Patch('items/:id')
  @Authenticated()
  update(
    @TenantCtx() ctx: TenantContext,
    @Param('id', { schema: Id }) id: string,
    @Body({ schema: UpdateInboxItemRequest }) body: UpdateInboxItemRequest,
  ) {
    return this.inbox.update(ctx, id, body);
  }

  @Post('items/:id/status')
  @HttpCode(200)
  @Authenticated()
  setStatus(
    @TenantCtx() ctx: TenantContext,
    @Param('id', { schema: Id }) id: string,
    @Body({ schema: SetStatusRequest }) body: z.infer<typeof SetStatusRequest>,
  ) {
    return this.inbox.setStatus(ctx, id, body.status);
  }

  @Delete('items/:id')
  @HttpCode(204)
  @Authenticated()
  remove(@TenantCtx() ctx: TenantContext, @Param('id', { schema: Id }) id: string) {
    return this.inbox.remove(ctx, id);
  }

  @Post('messages')
  @Authenticated()
  send(@TenantCtx() ctx: TenantContext, @Body({ schema: SendMessageRequest }) body: SendMessageRequest) {
    return this.inbox.send(ctx, body);
  }
}
