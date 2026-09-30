import { Module } from '@nestjs/common';
import { EmploymentController, LeaveController } from './api/leave.controller.js';
import { BalanceService } from './application/balance.service.js';
import { HcmSetupService } from './application/hcm-setup.service.js';
import { LeaveService } from './application/leave.service.js';
import { HcmPublicApi } from './public/hcm-public-api.js';

/** Human capital: employment, leave and (next) attendance — ported from Simorgh Kara. */
@Module({
  controllers: [LeaveController, EmploymentController],
  providers: [HcmSetupService, BalanceService, LeaveService, HcmPublicApi],
  exports: [HcmPublicApi],
})
export class HcmModule {}
