import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import {
  CalendarRangeQuery,
  CORE_PERMISSIONS,
  CreateHolidayRequest,
  ImportOfficialHolidaysRequest,
  ScheduleOverrideRequest,
  WorkScheduleRequest,
} from '@simorgh/contracts';
import { z } from 'zod';
import { TenantCtx, type TenantContext } from '../http/context.js';
import { Authenticated, RequirePermission } from '../rbac/permission.guard.js';
import { CalendarService } from './calendar.service.js';

const Id = z.uuid();
const IsoDate = z.iso.date();

/** Everyone in the company reads the calendar; calendar.manage changes it. */
@Controller('api/v1/core/calendar')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get('holidays')
  @Authenticated()
  holidays(@TenantCtx() ctx: TenantContext, @Query({ schema: CalendarRangeQuery }) q: CalendarRangeQuery) {
    return this.calendar.holidays(ctx, q.from, q.to);
  }

  @Post('holidays')
  @RequirePermission(CORE_PERMISSIONS['calendar.manage'])
  addHoliday(@TenantCtx() ctx: TenantContext, @Body({ schema: CreateHolidayRequest }) body: CreateHolidayRequest) {
    return this.calendar.addHoliday(ctx, body);
  }

  @Post('holidays/import-official')
  @RequirePermission(CORE_PERMISSIONS['calendar.manage'])
  importOfficial(@TenantCtx() ctx: TenantContext, @Body({ schema: ImportOfficialHolidaysRequest }) body: ImportOfficialHolidaysRequest) {
    return this.calendar.importOfficial(ctx, body.jalaliYear);
  }

  @Delete('holidays/:id')
  @HttpCode(204)
  @RequirePermission(CORE_PERMISSIONS['calendar.manage'])
  removeHoliday(@TenantCtx() ctx: TenantContext, @Param('id', { schema: Id }) id: string) {
    return this.calendar.removeHoliday(ctx, id);
  }

  @Get('schedules')
  @Authenticated()
  schedules(@TenantCtx() ctx: TenantContext) {
    return this.calendar.schedules(ctx);
  }

  @Post('schedules')
  @RequirePermission(CORE_PERMISSIONS['calendar.manage'])
  createSchedule(@TenantCtx() ctx: TenantContext, @Body({ schema: WorkScheduleRequest }) body: WorkScheduleRequest) {
    return this.calendar.saveSchedule(ctx, body);
  }

  @Put('schedules/:id')
  @RequirePermission(CORE_PERMISSIONS['calendar.manage'])
  updateSchedule(
    @TenantCtx() ctx: TenantContext,
    @Param('id', { schema: Id }) id: string,
    @Body({ schema: WorkScheduleRequest }) body: WorkScheduleRequest,
  ) {
    return this.calendar.saveSchedule(ctx, body, id);
  }

  @Delete('schedules/:id')
  @HttpCode(204)
  @RequirePermission(CORE_PERMISSIONS['calendar.manage'])
  removeSchedule(@TenantCtx() ctx: TenantContext, @Param('id', { schema: Id }) id: string) {
    return this.calendar.removeSchedule(ctx, id);
  }

  @Get('overrides')
  @Authenticated()
  overrides(@TenantCtx() ctx: TenantContext, @Query({ schema: CalendarRangeQuery }) q: CalendarRangeQuery) {
    return this.calendar.overrides(ctx, q.from, q.to);
  }

  @Put('overrides')
  @RequirePermission(CORE_PERMISSIONS['calendar.manage'])
  setOverride(@TenantCtx() ctx: TenantContext, @Body({ schema: ScheduleOverrideRequest }) body: ScheduleOverrideRequest) {
    return this.calendar.setOverride(ctx, body);
  }

  @Delete('overrides/:date')
  @HttpCode(204)
  @RequirePermission(CORE_PERMISSIONS['calendar.manage'])
  removeOverride(@TenantCtx() ctx: TenantContext, @Param('date', { schema: IsoDate }) date: string) {
    return this.calendar.removeOverride(ctx, date);
  }
}
