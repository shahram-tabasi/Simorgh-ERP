import { Injectable } from '@nestjs/common';
import type { CreateHolidayRequest, ScheduleOverrideRequest, WorkScheduleRequest } from '@simorgh/contracts';
import { holidays, scheduleOverrides, workSchedules, type Tx } from '@simorgh/db';
import { iranianWeekday, iranOfficialHolidays, toJalali, todayIso } from '@simorgh/jalali';
import { and, asc, between, eq, ne, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { DbService } from '../db/db.module.js';
import { ApiError } from '../http/api-error.js';
import type { TenantContext } from '../http/context.js';
import { pgError } from '../http/pg-error.js';

/**
 * Company-wide days off: Friday (the weekly rest day, Labour Law art. 62) and
 * holidays marked off — unless an exception makes the date a working day —
 * plus dates an exception declares off.
 */
export class CalendarDays {
  constructor(
    private readonly holidaysOff: ReadonlySet<string>,
    private readonly workingOverrides: ReadonlySet<string>,
    private readonly offOverrides: ReadonlySet<string>,
  ) {}

  isOff(date: string): boolean {
    if (this.offOverrides.has(date)) return true;
    if (this.workingOverrides.has(date)) return false;
    return this.holidaysOff.has(date) || iranianWeekday(date) === 6;
  }
}

/**
 * The tenant's work calendar: holidays, work schedules and per-date
 * exceptions (Kara's calendar module). HCM counts leave days with it;
 * planning will schedule work with it.
 */
@Injectable()
export class CalendarService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  // ── holidays ────────────────────────────────────────────────────────────

  holidays(ctx: TenantContext, from: string, to: string) {
    return this.db.tenant(ctx, (tx) =>
      tx.select().from(holidays).where(between(holidays.holidayDate, from, to)).orderBy(asc(holidays.holidayDate)),
    );
  }

  addHoliday(ctx: TenantContext, body: CreateHolidayRequest) {
    return this.db.tenant(ctx, async (tx) => {
      const [row] = await tx
        .insert(holidays)
        .values({ tenantId: sql`core.current_tenant()`, holidayDate: body.date, title: body.title, isOfficial: body.isOfficial, isOff: body.isOff })
        .returning()
        .catch((err: unknown) => {
          if (pgError(err)?.code === '23505') throw ApiError.conflict('HOLIDAY_EXISTS', 'This holiday is already on the calendar');
          throw err;
        });
      await this.audit.record(tx, ctx, { action: 'core.holiday.create', entityType: 'core.holiday', entityId: row!.id, after: row });
      return row!;
    });
  }

  removeHoliday(ctx: TenantContext, id: string) {
    return this.db.tenant(ctx, async (tx) => {
      const [row] = await tx.delete(holidays).where(eq(holidays.id, id)).returning();
      if (!row) throw ApiError.notFound('HOLIDAY_NOT_FOUND', 'Holiday not found');
      await this.audit.record(tx, ctx, { action: 'core.holiday.delete', entityType: 'core.holiday', entityId: id, before: row });
    });
  }

  importOfficial(ctx: TenantContext, jalaliYear: number): Promise<{ added: number }> {
    return this.db.tenant(ctx, async (tx) => {
      const added = await this.seedOfficial(tx, jalaliYear);
      await this.audit.record(tx, ctx, { action: 'core.holiday.import_official', entityType: 'core.holiday', after: { jalaliYear, added } });
      return { added };
    });
  }

  /** Adds Iran's official holidays of a Jalali year; existing rows are kept as edited. */
  async seedOfficial(tx: Tx, jalaliYear: number): Promise<number> {
    const rows = await tx
      .insert(holidays)
      .values(
        iranOfficialHolidays(jalaliYear).map((h) => ({
          tenantId: sql`core.current_tenant()`,
          holidayDate: h.date,
          title: h.title,
          isOfficial: true,
          isOff: true,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: holidays.id });
    return rows.length;
  }

  /** What a new tenant starts with: a Saturday–Wednesday schedule and this and next year's holidays. */
  async seedTenant(tx: Tx, now = new Date()): Promise<void> {
    await tx.insert(workSchedules).values({
      tenantId: sql`core.current_tenant()`,
      name: 'برنامهٔ پیش‌فرض',
      workDays: [0, 1, 2, 3, 4],
      startTime: '08:00',
      endTime: '17:00',
      isDefault: true,
    });
    const jy = toJalali(todayIso(now)).jy;
    await this.seedOfficial(tx, jy);
    await this.seedOfficial(tx, jy + 1);
  }

  /** The calendar between two dates, for asking which days are off. */
  async days(tx: Tx, from: string, to: string): Promise<CalendarDays> {
    const off = await tx
      .select({ d: holidays.holidayDate })
      .from(holidays)
      .where(and(between(holidays.holidayDate, from, to), eq(holidays.isOff, true)));
    const overrides = await tx
      .select({ d: scheduleOverrides.overrideDate, working: scheduleOverrides.isWorking })
      .from(scheduleOverrides)
      .where(between(scheduleOverrides.overrideDate, from, to));
    return new CalendarDays(
      new Set(off.map((r) => r.d)),
      new Set(overrides.filter((o) => o.working).map((o) => o.d)),
      new Set(overrides.filter((o) => !o.working).map((o) => o.d)),
    );
  }

  // ── work schedules ──────────────────────────────────────────────────────

  schedules(ctx: TenantContext) {
    return this.db.tenant(ctx, (tx) => tx.select().from(workSchedules).orderBy(asc(workSchedules.name)));
  }

  saveSchedule(ctx: TenantContext, body: WorkScheduleRequest, id?: string) {
    return this.db.tenant(ctx, async (tx) => {
      const values = {
        name: body.name,
        workDays: [...new Set(body.workDays)].sort(),
        startTime: body.startTime,
        endTime: body.endTime,
        isDefault: body.isDefault,
      };
      // one default per tenant: setting a new one clears the old
      if (body.isDefault) {
        await tx.update(workSchedules).set({ isDefault: false }).where(id ? ne(workSchedules.id, id) : undefined);
      }
      const onDup = (err: unknown): never => {
        if (pgError(err)?.code === '23505') throw ApiError.conflict('SCHEDULE_NAME_TAKEN', 'Another schedule has this name');
        throw err;
      };
      const [row] = id
        ? await tx.update(workSchedules).set(values).where(eq(workSchedules.id, id)).returning().catch(onDup)
        : await tx.insert(workSchedules).values({ tenantId: sql`core.current_tenant()`, ...values }).returning().catch(onDup);
      if (!row) throw ApiError.notFound('SCHEDULE_NOT_FOUND', 'Work schedule not found');
      await this.audit.record(tx, ctx, { action: id ? 'core.work_schedule.update' : 'core.work_schedule.create', entityType: 'core.work_schedule', entityId: row.id, after: row });
      return row;
    });
  }

  removeSchedule(ctx: TenantContext, id: string) {
    return this.db.tenant(ctx, async (tx) => {
      const [row] = await tx.delete(workSchedules).where(eq(workSchedules.id, id)).returning();
      if (!row) throw ApiError.notFound('SCHEDULE_NOT_FOUND', 'Work schedule not found');
      await this.audit.record(tx, ctx, { action: 'core.work_schedule.delete', entityType: 'core.work_schedule', entityId: id, before: row });
    });
  }

  // ── per-date exceptions ─────────────────────────────────────────────────

  overrides(ctx: TenantContext, from: string, to: string) {
    return this.db.tenant(ctx, (tx) =>
      tx.select().from(scheduleOverrides).where(between(scheduleOverrides.overrideDate, from, to)).orderBy(asc(scheduleOverrides.overrideDate)),
    );
  }

  setOverride(ctx: TenantContext, body: ScheduleOverrideRequest) {
    return this.db.tenant(ctx, async (tx) => {
      const [row] = await tx
        .insert(scheduleOverrides)
        .values({ tenantId: sql`core.current_tenant()`, overrideDate: body.date, isWorking: body.isWorking, note: body.note ?? null })
        .onConflictDoUpdate({
          target: [scheduleOverrides.tenantId, scheduleOverrides.overrideDate],
          set: { isWorking: body.isWorking, note: body.note ?? null },
        })
        .returning();
      await this.audit.record(tx, ctx, { action: 'core.schedule_override.set', entityType: 'core.schedule_override', entityId: row!.id, after: row });
      return row!;
    });
  }

  removeOverride(ctx: TenantContext, date: string) {
    return this.db.tenant(ctx, async (tx) => {
      const [row] = await tx.delete(scheduleOverrides).where(eq(scheduleOverrides.overrideDate, date)).returning();
      if (!row) throw ApiError.notFound('OVERRIDE_NOT_FOUND', 'No exception on this date');
      await this.audit.record(tx, ctx, { action: 'core.schedule_override.delete', entityType: 'core.schedule_override', entityId: row.id, before: row });
    });
  }
}
