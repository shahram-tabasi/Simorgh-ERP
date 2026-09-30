import { describe, expect, it } from 'vitest';
import {
  addDays, dayDiff, formatJalali, formatJalaliLong, iranianWeekday, isLeapJalali, jalaliMonthLength,
  iranOfficialHolidays, jalaliYearRange, timeToMinutes, toGregorian, toJalali, todayIso,
} from '../src/index.js';

describe('jalali', () => {
  it('converts known dates both ways', () => {
    // Nowruz of recent years (published calendars)
    expect(toGregorian(1403, 1, 1)).toBe('2024-03-20');
    expect(toGregorian(1404, 1, 1)).toBe('2025-03-21');
    expect(toGregorian(1405, 1, 1)).toBe('2026-03-21');
    expect(toJalali('2026-09-29')).toEqual({ jy: 1405, jm: 7, jd: 7 });
    expect(toJalali('2024-03-19')).toEqual({ jy: 1402, jm: 12, jd: 29 });
  });

  it('round-trips every day of several years', () => {
    let d = '2020-01-01';
    for (let i = 0; i < 365 * 12; i++) {
      const j = toJalali(d);
      expect(toGregorian(j.jy, j.jm, j.jd)).toBe(d);
      d = addDays(d, 1);
    }
  });

  it('knows leap years and month lengths', () => {
    expect(isLeapJalali(1403)).toBe(true); // 1403/12/30 exists
    expect(isLeapJalali(1404)).toBe(false);
    expect(jalaliMonthLength(1403, 12)).toBe(30);
    expect(jalaliMonthLength(1404, 12)).toBe(29);
    expect(jalaliMonthLength(1404, 1)).toBe(31);
    expect(jalaliMonthLength(1404, 7)).toBe(30);
    expect(() => toGregorian(1404, 12, 30)).toThrow(RangeError);
    expect(jalaliYearRange(1403)).toEqual({ from: '2024-03-20', to: '2025-03-20' });
  });

  it('counts weekdays from Saturday', () => {
    expect(iranianWeekday('2026-09-26')).toBe(0); // Saturday
    expect(iranianWeekday('2026-10-02')).toBe(6); // Friday
  });

  it('does date arithmetic without time-zone drift', () => {
    expect(addDays('2026-03-20', 1)).toBe('2026-03-21');
    expect(dayDiff('2025-03-21', '2026-03-21')).toBe(365);
  });

  it('formats in Persian', () => {
    expect(formatJalali('2026-09-29')).toBe('۱۴۰۵/۰۷/۰۷');
    expect(formatJalaliLong('2026-09-29')).toBe('۷ مهر ۱۴۰۵');
    expect(timeToMinutes('08:30')).toBe(510);
    expect(() => timeToMinutes('8:30')).toThrow();
  });

  it('takes "today" in Tehran, not the server zone', () => {
    // 22:00 UTC on 2026-09-29 is already 2026-09-30 in Tehran (UTC+3:30)
    expect(todayIso(new Date('2026-09-29T22:00:00Z'))).toBe('2026-09-30');
  });
});

describe('official holidays', () => {
  it('places the solar and lunar holidays of 1404', () => {
    const h = iranOfficialHolidays(1404);
    const on = (title: string) => h.filter((x) => x.title === title).map((x) => x.date);
    expect(on('عید نوروز')).toEqual(['2025-03-21', '2025-03-22', '2025-03-23', '2025-03-24']);
    expect(on('پیروزی انقلاب اسلامی')).toEqual(['2026-02-11']);
    // lunar dates are estimates: within a day of the dates Iran announced
    const near = (title: string, official: string) => expect(Math.abs(dayDiff(official, on(title)[0]!))).toBeLessThanOrEqual(1);
    near('تاسوعای حسینی', '2025-07-05');
    near('عاشورای حسینی', '2025-07-06');
    near('عید سعید فطر', '2025-03-31');
    near('عید سعید قربان', '2025-06-06');
    expect(on('تاسوعای حسینی')).toEqual(['2025-07-05']);
    expect(h.every((x, i) => i === 0 || h[i - 1]!.date <= x.date)).toBe(true);
    expect(h.length).toBeGreaterThanOrEqual(24);
  });
});
