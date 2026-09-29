import { Module } from '@nestjs/common';
import { PermissionCatalogService } from './permission-catalog.service.js';
import { PermissionsController, RolesController } from './roles.controller.js';
import { RolesService } from './roles.service.js';
import { RbacService } from './rbac.service.js';

@Module({
  controllers: [RolesController, PermissionsController],
  providers: [RbacService, PermissionCatalogService, RolesService],
  exports: [RbacService, PermissionCatalogService],
})
export class RbacModule {}
