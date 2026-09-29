import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { MembersService } from './members.service.js';
import { ProvisioningService } from './provisioning.service.js';
import { LegalEntitiesController, MembersController, PlatformTenantsController } from './tenancy.controllers.js';

@Module({
  imports: [IdentityModule, RbacModule],
  controllers: [PlatformTenantsController, MembersController, LegalEntitiesController],
  providers: [ProvisioningService, MembersService],
})
export class TenancyModule {}
