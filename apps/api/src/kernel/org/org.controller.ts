import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { CORE_PERMISSIONS, CreateOrgUnitRequest, SetOrgUnitMemberRequest, UpdateOrgUnitRequest } from '@simorgh/contracts';
import { z } from 'zod';
import { TenantCtx, type TenantContext } from '../http/context.js';
import { RequirePermission } from '../rbac/permission.guard.js';
import { OrgService } from './org.service.js';

const Id = z.uuid();

@Controller('api/v1/core/org-units')
export class OrgUnitsController {
  constructor(private readonly org: OrgService) {}

  @Get()
  @RequirePermission(CORE_PERMISSIONS['org_unit.view'])
  list(@TenantCtx() ctx: TenantContext) {
    return this.org.list(ctx);
  }

  @Post()
  @RequirePermission(CORE_PERMISSIONS['org_unit.manage'])
  create(@TenantCtx() ctx: TenantContext, @Body({ schema: CreateOrgUnitRequest }) body: CreateOrgUnitRequest) {
    return this.org.create(ctx, body);
  }

  @Patch(':id')
  @RequirePermission(CORE_PERMISSIONS['org_unit.manage'])
  update(
    @TenantCtx() ctx: TenantContext,
    @Param('id', { schema: Id }) id: string,
    @Body({ schema: UpdateOrgUnitRequest }) body: UpdateOrgUnitRequest,
  ) {
    return this.org.update(ctx, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission(CORE_PERMISSIONS['org_unit.manage'])
  remove(@TenantCtx() ctx: TenantContext, @Param('id', { schema: Id }) id: string) {
    return this.org.remove(ctx, id);
  }

  @Get(':id/members')
  @RequirePermission(CORE_PERMISSIONS['org_unit.view'])
  members(@TenantCtx() ctx: TenantContext, @Param('id', { schema: Id }) id: string) {
    return this.org.members(ctx, id);
  }

  @Put(':id/members/:userId')
  @RequirePermission(CORE_PERMISSIONS['org_unit.manage'])
  setMember(
    @TenantCtx() ctx: TenantContext,
    @Param('id', { schema: Id }) id: string,
    @Param('userId', { schema: Id }) userId: string,
    @Body({ schema: SetOrgUnitMemberRequest }) body: SetOrgUnitMemberRequest,
  ) {
    return this.org.setMember(ctx, id, userId, body.isPrimary);
  }

  @Delete(':id/members/:userId')
  @HttpCode(204)
  @RequirePermission(CORE_PERMISSIONS['org_unit.manage'])
  removeMember(
    @TenantCtx() ctx: TenantContext,
    @Param('id', { schema: Id }) id: string,
    @Param('userId', { schema: Id }) userId: string,
  ) {
    return this.org.removeMember(ctx, id, userId);
  }
}
