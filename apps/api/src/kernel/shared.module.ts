import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit/audit.controller.js';
import { AuditService } from './audit/audit.service.js';
import { NumberingController } from './numbering/numbering.controller.js';
import { NumberingService } from './numbering/numbering.service.js';
import { OutboxService } from './outbox/outbox.service.js';

/** In-transaction services every module uses: audit trail, outbox, document numbers. */
@Global()
@Module({
  controllers: [AuditController, NumberingController],
  providers: [AuditService, OutboxService, NumberingService],
  exports: [AuditService, OutboxService, NumberingService],
})
export class KernelSharedModule {}
