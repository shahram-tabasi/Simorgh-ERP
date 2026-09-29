import { Body, Controller, Get, Param, Patch, Post, Delete } from '@nestjs/common';
import { AddMemberRequest, AssignRoleRequest, CORE_PERMISSIONS, CreateTenantRequest } from '@simorgh/contracts';
import { legalEntities } from '@simorgh/db';
import { asc } from 'drizzle-orm';
import { z } from 'zod';
import { DbService } from '../db/db.module.js';
import { Ctx, TenantCtx, type RequestContext, type TenantContext } from '../http/context.js';
import { PlatformAdminOnly, RequirePermission } from '../rbac/permission.guard.js';
import { MembersService } from './members.service.js';
import { ProvisioningService } from './provisioning.service.js';

const Id = z.uuid();
const SetStatus = z.object({ status: z.enum(['active', 'disabled']) });

@Controller('api/v1/platform/tenants')
export class PlatformTenantsController {
  constructor(private readonly provisioning: ProvisioningService) {}

  @Get()
  @PlatformAdminOnly()
  list(@Ctx() ctx: RequestContext) {
    return this.provisioning.list(ctx);
  }

  @Post()
  @PlatformAdminOnly()
  create(@Ctx() ctx: RequestContext, @Body({ schema: CreateTenantRequest }) body: CreateTenantRequest) {
    return this.provisioning.provision(ctx, body);
  }
}

@Controller('api/v1/core/members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @RequirePermission(CORE_PERMISSIONS['member.view'])
  list(@TenantCtx() ctx: TenantContext) {
    return this.members.list(ctx);
  }

  @Post()
  @RequirePermission(CORE_PERMISSIONS['member.manage'])
  add(@TenantCtx() ctx: TenantContext, @Body({ schema: AddMemberRequest }) body: AddMemberRequest) {
    return this.members.add(ctx, body);
  }

  @Patch(':userId')
  @RequirePermission(CORE_PERMISSIONS['member.manage'])
  setStatus(
    @TenantCtx() ctx: TenantContext,
    @Param('userId', { schema: Id }) userId: string,
    @Body({ schema: SetStatus }) body: z.infer<typeof SetStatus>,
  ) {
    return this.members.setStatus(ctx, userId, body.status);
  }

  @Post(':userId/roles')
  @RequirePermission(CORE_PERMISSIONS['member.manage'])
  assignRole(
    @TenantCtx() ctx: TenantContext,
    @Param('userId', { schema: Id }) userId: string,
    @Body({ schema: AssignRoleRequest }) body: AssignRoleRequest,
  ) {
    return this.members.assignRole(ctx, userId, body);
  }

  @Delete(':userId/roles/:assignmentId')
  @RequirePermission(CORE_PERMISSIONS['member.manage'])
  unassignRole(
    @TenantCtx() ctx: TenantContext,
    @Param('userId', { schema: Id }) userId: string,
    @Param('assignmentId', { schema: Id }) assignmentId: string,
  ) {
    return this.members.unassignRole(ctx, userId, assignmentId);
  }
}

@Controller('api/v1/core/legal-entities')
export class LegalEntitiesController {
  constructor(private readonly db: DbService) {}

  @Get()
  @RequirePermission(CORE_PERMISSIONS['legal_entity.view'])
  list(@TenantCtx() ctx: TenantContext) {
    return this.db.tenant(ctx, (tx) => tx.select().from(legalEntities).orderBy(asc(legalEntities.code)));
  }
}
