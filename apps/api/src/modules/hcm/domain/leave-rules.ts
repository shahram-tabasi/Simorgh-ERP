/**
 * Leave arithmetic, from Kara's lib/leave-balance.ts — pure functions, no
 * database, no clock (today is a parameter), so every rule is testable alone.
 */
import { addDays, dayDiff, iranianWeekday, jalaliYearRange, timeToMinutes, toGregorian, type IsoDate } from '@simorgh/jalali';

/** Minutes of work that make one leave day, by site: head office 08:30, factory 07:20. */
export const SITE_MINUTES = { hq: 510, factory: 440, guard: 510 } as const;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface EffectiveDaysArgs {
  unit: 'day' | 'hour';
  countsInnerHolidays: boolean;
  from: IsoDate;
  to: IsoDate;
  fromTime?: string | null;
  toTime?: string | null;
  isOff: (date: IsoDate) => boolean;
  dailyMinutes: number;
}

/**
 * Billable leave in days. Day leave skips Fridays and holidays inside the
 * range unless the type counts them (تبصره ۱); hourly leave becomes a
 * fraction of the person's working day.
 */
export function effectiveDays(a: EffectiveDaysArgs): number {
  if (a.unit === 'hour') {
    if (!a.fromTime || !a.toTime) return 0;
    const minutes = timeToMinutes(a.toTime) - timeToMinutes(a.fromTime);
    return minutes > 0 ? round2(minutes / a.dailyMinutes) : 0;
  }
  let count = 0;
  for (let d = a.from; d <= a.to; d = addDays(d, 1)) if (a.countsInnerHolidays || !a.isOff(d)) count++;
  return count;
}

/**
 * Entitlement earned in Jalali year `jy` up to `today`, prorated by days of
 * service (a person hired mid-year earns the remainder).
 */
export function proratedAccrual(hireDate: IsoDate | null, jy: number, annual: number, today: IsoDate): number {
  const year = jalaliYearRange(jy);
  const yearLength = dayDiff(year.from, toGregorian(jy + 1, 1, 1));
  const start = hireDate && hireDate > year.from ? hireDate : year.from;
  const end = today < year.to ? today : year.to;
  if (end < start) return 0;
  return round2((annual * (dayDiff(start, end) + 1)) / yearLength);
}

/** The Saturday-to-Friday week containing `date`. */
export function iranianWeek(date: IsoDate): { from: IsoDate; to: IsoDate } {
  const from = addDays(date, -iranianWeekday(date));
  return { from, to: addDays(from, 6) };
}

/** Minutes between two HH:MM times. */
export function minutesBetween(from: string, to: string): number {
  return timeToMinutes(to) - timeToMinutes(from);
}
