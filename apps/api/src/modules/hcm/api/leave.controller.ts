import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  BalanceQuery,
  EmploymentRequest,
  HCM_PERMISSIONS,
  LeaveListQuery,
  LeavePolicyRequest,
  LeaveTypeRequest,
  LedgerEntryRequest,
  SubmitLeaveRequest,
  UpdateLeaveTypeRequest,
} from '@simorgh/contracts';
import { z } from 'zod';
import { TenantCtx, type TenantContext } from '../../../kernel/http/context.js';
import { Authenticated, RequirePermission } from '../../../kernel/rbac/permission.guard.js';
import { BalanceService } from '../application/balance.service.js';
import { HcmSetupService } from '../application/hcm-setup.service.js';
import { LeaveService } from '../application/leave.service.js';

const Id = z.uuid();
const ListQuery = LeaveListQuery.extend({ team: z.stringbool().default(false) });
const YearQuery = z.object({ jalaliYear: z.coerce.number().int().min(1350).max(1500).optional() });

/**
 * Every member files and follows their own leave. Seeing or changing
 * someone else's is decided per person, against the scope of the caller's
 * hcm permissions.
 */
@Controller('api/v1/hcm/leave')
export class LeaveController {
  constructor(
    private readonly leave: LeaveService,
    private readonly balances: BalanceService,
    private readonly setup: HcmSetupService,
  ) {}

  @Get('requests')
  @Authenticated()
  list(@TenantCtx() ctx: TenantContext, @Query({ schema: ListQuery }) q: z.infer<typeof ListQuery>) {
    return this.leave.list(ctx, q);
  }

  @Post('requests')
  @Authenticated()
  submit(@TenantCtx() ctx: TenantContext, @Body({ schema: SubmitLeaveRequest }) body: SubmitLeaveRequest) {
    return this.leave.submit(ctx, body);
  }

  @Get('requests/:id')
  @Authenticated()
  get(@TenantCtx() ctx: TenantContext, @Param('id', { schema: Id }) id: string) {
    return this.leave.get(ctx, id);
  }

  @Post('requests/:id/cancel')
  @HttpCode(200)
  @Authenticated()
  cancel(@TenantCtx() ctx: TenantContext, @Param('id', { schema: Id }) id: string) {
    return this.leave.cancel(ctx, id);
  }

  @Get('balance')
  @Authenticated()
  balance(@TenantCtx() ctx: TenantContext, @Query({ schema: BalanceQuery }) q: BalanceQuery) {
    return this.balances.balance(ctx, q.userId, q.jalaliYear);
  }

  @Get('balances')
  @RequirePermission(HCM_PERMISSIONS['leave.view'])
  team(@TenantCtx() ctx: TenantContext, @Query({ schema: YearQuery }) q: z.infer<typeof YearQuery>) {
    return this.balances.team(ctx, q.jalaliYear);
  }

  @Get('ledger/:userId')
  @Authenticated()
  ledger(
    @TenantCtx() ctx: TenantContext,
    @Param('userId', { schema: Id }) userId: string,
    @Query({ schema: YearQuery }) q: z.infer<typeof YearQuery>,
  ) {
    return this.balances.ledger(ctx, userId, q.jalaliYear);
  }

  @Post('ledger')
  @RequirePermission(HCM_PERMISSIONS['leave_ledger.manage'])
  addLedgerEntry(@TenantCtx() ctx: TenantContext, @Body({ schema: LedgerEntryRequest }) body: LedgerEntryRequest) {
    return this.balances.addLedgerEntry(ctx, body);
  }

  @Get('types')
  @Authenticated()
  types(@TenantCtx() ctx: TenantContext) {
    return this.setup.types(ctx);
  }

  @Post('types')
  @RequirePermission(HCM_PERMISSIONS['leave_type.manage'])
  createType(@TenantCtx() ctx: TenantContext, @Body({ schema: LeaveTypeRequest }) body: LeaveTypeRequest) {
    return this.setup.createType(ctx, body);
  }

  @Patch('types/:id')
  @RequirePermission(HCM_PERMISSIONS['leave_type.manage'])
  updateType(
    @TenantCtx() ctx: TenantContext,
    @Param('id', { schema: Id }) id: string,
    @Body({ schema: UpdateLeaveTypeRequest }) body: UpdateLeaveTypeRequest,
  ) {
    return this.setup.updateType(ctx, id, body);
  }

  @Get('policy')
  @Authenticated()
  policy(@TenantCtx() ctx: TenantContext) {
    return this.setup.policy(ctx);
  }

  @Put('policy')
  @RequirePermission(HCM_PERMISSIONS['policy.manage'])
  setPolicy(@TenantCtx() ctx: TenantContext, @Body({ schema: LeavePolicyRequest }) body: LeavePolicyRequest) {
    return this.setup.setPolicy(ctx, body);
  }
}

@Controller('api/v1/hcm/employment')
export class EmploymentController {
  constructor(private readonly setup: HcmSetupService) {}

  @Get(':userId')
  @Authenticated()
  get(@TenantCtx() ctx: TenantContext, @Param('userId', { schema: Id }) userId: string) {
    return this.setup.employment(ctx, userId);
  }

  @Put(':userId')
  @RequirePermission(HCM_PERMISSIONS['employment.manage'])
  set(
    @TenantCtx() ctx: TenantContext,
    @Param('userId', { schema: Id }) userId: string,
    @Body({ schema: EmploymentRequest }) body: EmploymentRequest,
  ) {
    return this.setup.setEmployment(ctx, userId, body);
  }
}
