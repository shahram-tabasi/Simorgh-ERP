import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { CoreEvents, type CreateUploadRequest, type UploadTicket } from '@simorgh/contracts';
import { attachments, type Tx } from '@simorgh/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { CONFIG, type Config } from '../../config.js';
import { AuditService } from '../audit/audit.service.js';
import { DbService } from '../db/db.module.js';
import { ApiError } from '../http/api-error.js';
import type { TenantContext } from '../http/context.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { OBJECT_STORAGE, type ObjectStorage } from './object-storage.js';

type Attachment = typeof attachments.$inferSelect;

/**
 * Two-step upload: the API records the attachment as `pending` and hands out a
 * presigned PUT; the client uploads straight to object storage (bytes never
 * pass through the API) and then calls `complete`, which checks the stored
 * object before the attachment becomes `stored`.
 */
@Injectable()
export class AttachmentsService implements OnApplicationBootstrap {
  private readonly log = new Logger(AttachmentsService.name);

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** Best effort: the API still starts without object storage; only uploads fail. */
  async onApplicationBootstrap(): Promise<void> {
    await this.storage.ensureBucket().catch((err: Error) => this.log.warn(`object storage not ready: ${err.message}`));
  }

  createUpload(ctx: TenantContext, body: CreateUploadRequest): Promise<UploadTicket> {
    const key = `${ctx.tenantId}/${body.ownerType}/${body.ownerId}/${randomUUID()}`;
    return this.db.tenant(ctx, async (tx) => {
      const [row] = await tx
        .insert(attachments)
        .values({
          tenantId: sql`core.current_tenant()`,
          ownerType: body.ownerType,
          ownerId: body.ownerId,
          category: body.category ?? null,
          fileName: body.fileName,
          mimeType: body.mimeType,
          sizeBytes: body.sizeBytes,
          sha256: body.sha256,
          storageKey: key,
          createdBy: ctx.userId,
        })
        .returning();
      const ttl = this.config.UPLOAD_URL_TTL_SEC;
      const put = await this.storage.presignPut(key, { contentType: body.mimeType, sizeBytes: body.sizeBytes, sha256Hex: body.sha256 }, ttl);
      return { attachmentId: row!.id, uploadUrl: put.url, headers: put.headers, expiresIn: ttl };
    });
  }

  complete(ctx: TenantContext, id: string): Promise<Attachment> {
    return this.db.tenant(ctx, async (tx) => {
      const row = await this.find(tx, id);
      if (row.status === 'stored') return row;
      const obj = await this.storage.head(row.storageKey);
      if (!obj) throw ApiError.conflict('UPLOAD_MISSING', 'The file has not been uploaded yet');
      if (obj.size !== row.sizeBytes || (obj.sha256Hex && obj.sha256Hex !== row.sha256)) {
        throw ApiError.conflict('UPLOAD_MISMATCH', 'The uploaded file does not match what was declared');
      }
      const [stored] = await tx.update(attachments).set({ status: 'stored' }).where(eq(attachments.id, id)).returning();
      await this.audit.record(tx, ctx, { action: 'core.attachment.store', entityType: 'core.attachment', entityId: id, after: stored });
      await this.outbox.enqueue(tx, ctx, {
        type: CoreEvents.attachmentStored,
        subject: { type: 'core.attachment', id },
        data: { ownerType: row.ownerType, ownerId: row.ownerId, fileName: row.fileName, mimeType: row.mimeType, sizeBytes: row.sizeBytes },
      });
      return stored!;
    });
  }

  list(ctx: TenantContext, ownerType: string, ownerId: string): Promise<Attachment[]> {
    return this.db.tenant(ctx, (tx) =>
      tx
        .select()
        .from(attachments)
        .where(and(eq(attachments.ownerType, ownerType), eq(attachments.ownerId, ownerId), eq(attachments.status, 'stored')))
        .orderBy(desc(attachments.createdAt)),
    );
  }

  download(ctx: TenantContext, id: string): Promise<{ url: string; expiresIn: number }> {
    return this.db.tenant(ctx, async (tx) => {
      const row = await this.find(tx, id);
      if (row.status !== 'stored') throw ApiError.conflict('UPLOAD_PENDING', 'The file has not been stored yet');
      const ttl = this.config.UPLOAD_URL_TTL_SEC;
      return { url: await this.storage.presignGet(row.storageKey, row.fileName, ttl), expiresIn: ttl };
    });
  }

  private async find(tx: Tx, id: string): Promise<Attachment> {
    const [row] = await tx.select().from(attachments).where(eq(attachments.id, id));
    if (!row) throw ApiError.notFound('ATTACHMENT_NOT_FOUND', 'Attachment not found');
    return row;
  }
}
