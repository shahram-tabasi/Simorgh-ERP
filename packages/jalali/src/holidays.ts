/**
 * Official Iranian public holidays for a Jalali year — from Kara's
 * lib/iran-holidays.ts.
 *
 * Solar holidays sit on fixed Jalali dates and are exact. Religious holidays
 * follow the lunar Hijri calendar, which Iran fixes by moon sighting; here
 * they are estimated with the tabular Islamic calendar and can be a day off.
 * Tenants receive them as editable rows, to be checked against the official
 * calendar each year.
 *
 * Kara shifted every lunar date one day earlier. Checked against the dates
 * Iran announced for 1402–1404, the unshifted tabular date matches in most
 * cases (Fitr in all three years, Tasua in 1402 and 1404) and the shift in
 * few, so the shift is gone.
 */
import { addDays, jalaliYearRange, toGregorian, type IsoDate } from './index.js';

export interface OfficialHoliday {
  date: IsoDate;
  title: string;
  lunar: boolean;
}

const FIXED_SOLAR: readonly [number, number, string][] = [
  [1, 1, 'عید نوروز'],
  [1, 2, 'عید نوروز'],
  [1, 3, 'عید نوروز'],
  [1, 4, 'عید نوروز'],
  [1, 12, 'روز جمهوری اسلامی'],
  [1, 13, 'روز طبیعت (سیزده‌به‌در)'],
  [3, 14, 'رحلت امام خمینی'],
  [3, 15, 'قیام ۱۵ خرداد'],
  [11, 22, 'پیروزی انقلاب اسلامی'],
  [12, 29, 'روز ملی شدن صنعت نفت'],
];

const LUNAR: readonly [number, number, string][] = [
  [1, 9, 'تاسوعای حسینی'],
  [1, 10, 'عاشورای حسینی'],
  [2, 20, 'اربعین حسینی'],
  [2, 28, 'رحلت پیامبر و شهادت امام حسن مجتبی'],
  [2, 30, 'شهادت امام رضا (ع)'],
  [3, 17, 'میلاد پیامبر اکرم و امام جعفر صادق'],
  [7, 27, 'مبعث رسول اکرم'],
  [8, 15, 'ولادت حضرت قائم (نیمه شعبان)'],
  [9, 21, 'شهادت حضرت علی (ع)'],
  [10, 1, 'عید سعید فطر'],
  [10, 2, 'تعطیل عید فطر'],
  [10, 25, 'شهادت امام جعفر صادق'],
  [12, 10, 'عید سعید قربان'],
  [12, 18, 'عید سعید غدیر خم'],
];

// Julian Day Number of a proleptic Gregorian date, and back.
function gregorianToJdn(date: IsoDate): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}

function jdnToGregorian(jdn: number): IsoDate {
  // Offset from a known anchor keeps this exact and short.
  return addDays('2000-01-01', jdn - 2_451_545);
}

/** Tabular Islamic calendar → Julian Day Number. */
function islamicToJdn(iy: number, im: number, id: number): number {
  return id + Math.ceil(29.5 * (im - 1)) + (iy - 1) * 354 + Math.floor((3 + 11 * iy) / 30) + 1_948_439;
}

/** Every official holiday inside Jalali year `jy`, in date order. */
export function iranOfficialHolidays(jy: number): OfficialHoliday[] {
  const out: OfficialHoliday[] = FIXED_SOLAR.map(([jm, jd, title]) => ({ date: toGregorian(jy, jm, jd), title, lunar: false }));
  const range = jalaliYearRange(jy);
  const start = gregorianToJdn(range.from);
  const end = gregorianToJdn(range.to);
  // Hijri years overlapping this Jalali year: scan a small window around the estimate.
  const estimate = Math.floor((jy - 1) * 1.0307) + 1;
  for (let iy = estimate - 2; iy <= estimate + 2; iy++) {
    for (const [hm, hd, title] of LUNAR) {
      const jdn = islamicToJdn(iy, hm, hd);
      if (jdn >= start && jdn <= end) out.push({ date: jdnToGregorian(jdn), title, lunar: true });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
