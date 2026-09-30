/**
 * Jalali (Solar Hijri) calendar — dependency-free, from Simorgh Kara.
 *
 * The conversion is the jalaali-js algorithm (Roozbeh Pournader & Mohammad
 * Tavousi), unchanged from Kara. What changed: dates are plain ISO strings
 * (`YYYY-MM-DD`) handled in UTC, so a result never depends on the server's
 * time zone — Kara used local `Date`s, which shift by a day on a server
 * running in UTC late in the evening, Tehran time.
 */

export interface JDate {
  jy: number;
  jm: number;
  jd: number;
}

/** An ISO calendar date, `YYYY-MM-DD`. */
export type IsoDate = string;

// The reference algorithm truncates toward zero (JS `~~`), not Math.floor —
// with Math.floor, div(gm - 8, 6) is wrong for negative operands and shifts
// conversions by a whole year.
function div(a: number, b: number): number {
  return Math.trunc(a / b);
}
function mod(a: number, b: number): number {
  return a - div(a, b) * b;
}

const BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178,
];

function jalCal(jy: number): { leap: number; gy: number; march: number } {
  const bl = BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0]!;
  if (jy < jp || jy >= BREAKS[bl - 1]!) throw new RangeError(`Jalali year out of range: ${jy}`);

  let jump = 0;
  for (let i = 1; i < bl; i += 1) {
    const jm = BREAKS[i]!;
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

function g2d(gy: number, gm: number, gd: number): number {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn: number): { gy: number; gm: number; gd: number } {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

function j2d(jy: number, jm: number, jd: number): number {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

function d2j(jdn: number): JDate {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}

// ── ISO helpers (UTC, time-zone independent) ─────────────────────────────────

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parts(iso: IsoDate): [number, number, number] {
  const m = ISO_RE.exec(iso.slice(0, 10));
  if (!m) throw new TypeError(`not an ISO date: ${iso}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function iso(y: number, m: number, d: number): IsoDate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Jalali date of an ISO date. */
export function toJalali(date: IsoDate): JDate {
  const [y, m, d] = parts(date);
  return d2j(g2d(y, m, d));
}

/** ISO date of a Jalali date. */
export function toGregorian(jy: number, jm: number, jd: number): IsoDate {
  if (jm < 1 || jm > 12 || jd < 1 || jd > jalaliMonthLength(jy, jm)) {
    throw new RangeError(`invalid Jalali date ${jy}/${jm}/${jd}`);
  }
  const g = d2g(j2d(jy, jm, jd));
  return iso(g.gy, g.gm, g.gd);
}

export function isLeapJalali(jy: number): boolean {
  return jalCal(jy).leap === 0;
}

export function jalaliMonthLength(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isLeapJalali(jy) ? 30 : 29;
}

/** First and last ISO day of a Jalali month. */
export function jalaliMonthRange(jy: number, jm: number): { from: IsoDate; to: IsoDate } {
  return { from: toGregorian(jy, jm, 1), to: toGregorian(jy, jm, jalaliMonthLength(jy, jm)) };
}

/** First and last ISO day of a Jalali year. */
export function jalaliYearRange(jy: number): { from: IsoDate; to: IsoDate } {
  return { from: toGregorian(jy, 1, 1), to: toGregorian(jy, 12, jalaliMonthLength(jy, 12)) };
}

/** Days from `a` to `b` (b − a). */
export function dayDiff(a: IsoDate, b: IsoDate): number {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

export function addDays(date: IsoDate, n: number): IsoDate {
  const [y, m, d] = parts(date);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Iranian weekday: 0 = شنبه (Saturday) … 6 = جمعه (Friday). */
export function iranianWeekday(date: IsoDate): number {
  const [y, m, d] = parts(date);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 1) % 7;
}

/** Today's ISO date in Tehran (the calendar the business runs on). */
export function todayIso(now: Date = new Date(), timeZone = 'Asia/Tehran'): IsoDate {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export const JALALI_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
] as const;

/** Weekday names from Saturday (the Iranian week start). */
export const WEEKDAYS = ['شنبه', 'یک‌شنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه'] as const;

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

export function toFaDigits(input: string | number): string {
  return String(input).replace(/\d/g, (d) => FA_DIGITS[Number(d)]!);
}

/** `۱۴۰۵/۰۷/۰۷` */
export function formatJalali(date: IsoDate): string {
  const j = toJalali(date);
  return toFaDigits(`${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`);
}

/** `۷ مهر ۱۴۰۵` */
export function formatJalaliLong(date: IsoDate): string {
  const j = toJalali(date);
  return `${toFaDigits(j.jd)} ${JALALI_MONTHS[j.jm - 1]} ${toFaDigits(j.jy)}`;
}

/** "08:30" → 510 */
export function timeToMinutes(t: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(t);
  if (!m) throw new TypeError(`not a HH:MM time: ${t}`);
  return Number(m[1]) * 60 + Number(m[2]);
}
export * from './holidays.js';
