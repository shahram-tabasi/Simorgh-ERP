import { Body, Controller, Get, HttpCode, Module, Param, Post, Query } from '@nestjs/common';
import { CORE_PERMISSIONS, CreateUploadRequest } from '@simorgh/contracts';
import { z } from 'zod';
import { CONFIG, type Config } from '../../config.js';
import { TenantCtx, type TenantContext } from '../http/context.js';
import { RequirePermission } from '../rbac/permission.guard.js';
import { AttachmentsService } from './attachments.service.js';
import { OBJECT_STORAGE, S3ObjectStorage } from './object-storage.js';

const Id = z.uuid();
const OwnerQuery = z.object({ ownerType: z.string().regex(/^[a-z_]+\.[a-z_]+$/), ownerId: z.uuid() });

@Controller('api/v1/core/attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post('uploads')
  @RequirePermission(CORE_PERMISSIONS['attachment.upload'])
  createUpload(@TenantCtx() ctx: TenantContext, @Body({ schema: CreateUploadRequest }) body: CreateUploadRequest) {
    return this.attachments.createUpload(ctx, body);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @RequirePermission(CORE_PERMISSIONS['attachment.upload'])
  complete(@TenantCtx() ctx: TenantContext, @Param('id', { schema: Id }) id: string) {
    return this.attachments.complete(ctx, id);
  }

  @Get()
  @RequirePermission(CORE_PERMISSIONS['attachment.view'])
  list(@TenantCtx() ctx: TenantContext, @Query({ schema: OwnerQuery }) q: z.infer<typeof OwnerQuery>) {
    return this.attachments.list(ctx, q.ownerType, q.ownerId);
  }

  @Get(':id/download')
  @RequirePermission(CORE_PERMISSIONS['attachment.view'])
  download(@TenantCtx() ctx: TenantContext, @Param('id', { schema: Id }) id: string) {
    return this.attachments.download(ctx, id);
  }
}

@Module({
  controllers: [AttachmentsController],
  providers: [
    AttachmentsService,
    { provide: OBJECT_STORAGE, inject: [CONFIG], useFactory: (c: Config) => new S3ObjectStorage(c) },
  ],
})
export class FilesModule {}
