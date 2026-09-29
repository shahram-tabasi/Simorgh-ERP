import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { CORE_PERMISSIONS, CreateRoleRequest, SetRolePermissionsRequest } from '@simorgh/contracts';
import { z } from 'zod';
import { Authenticated, RequirePermission } from './permission.guard.js';
import { PermissionCatalogService } from './permission-catalog.service.js';
import { RolesService } from './roles.service.js';
import { TenantCtx, type TenantContext } from '../http/context.js';

const RoleId = z.uuid();

@Controller('api/v1/core/roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermission(CORE_PERMISSIONS['role.view'])
  list(@TenantCtx() ctx: TenantContext) {
    return this.roles.list(ctx);
  }

  @Post()
  @RequirePermission(CORE_PERMISSIONS['role.manage'])
  create(@TenantCtx() ctx: TenantContext, @Body({ schema: CreateRoleRequest }) body: CreateRoleRequest) {
    return this.roles.create(ctx, body);
  }

  @Put(':id/permissions')
  @RequirePermission(CORE_PERMISSIONS['role.manage'])
  setPermissions(
    @TenantCtx() ctx: TenantContext,
    @Param('id', { schema: RoleId }) id: string,
    @Body({ schema: SetRolePermissionsRequest }) body: SetRolePermissionsRequest,
  ) {
    return this.roles.setPermissions(ctx, id, body.permissions);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission(CORE_PERMISSIONS['role.manage'])
  remove(@TenantCtx() ctx: TenantContext, @Param('id', { schema: RoleId }) id: string) {
    return this.roles.remove(ctx, id);
  }
}

@Controller('api/v1/core/permissions')
export class PermissionsController {
  constructor(private readonly catalog: PermissionCatalogService) {}

  /** The catalog is the same for everyone; it is what roles are built from. */
  @Get()
  @Authenticated()
  list() {
    return this.catalog.all();
  }
}
