/**
 * The leave types a company starts with, from Kara's lib/leave-types.ts: the
 * Iranian Labour Law leave directive (EKWI-AD-006-01). Every field stays
 * editable per company.
 */
export interface LeaveTypeSeed {
  code: string;
  name: string;
  unit: 'day' | 'hour';
  paid: boolean;
  deductsEntitlement: boolean;
  countsInnerHolidays: boolean;
  requiresAttachment: boolean;
  maxMinutesPerDay: number | null;
  maxCountPerMonth: number | null;
  maxCountPerWeek: number | null;
  maxDaysPerYear: number | null;
  approvalLevels: number;
  sortOrder: number;
  description: string;
}

const base = {
  paid: true,
  deductsEntitlement: false,
  countsInnerHolidays: false,
  requiresAttachment: false,
  maxMinutesPerDay: null,
  maxCountPerMonth: null,
  maxCountPerWeek: null,
  maxDaysPerYear: null,
  approvalLevels: 2,
} as const;

export const DEFAULT_LEAVE_TYPES: LeaveTypeSeed[] = [
  { ...base, code: 'entitlement_daily', name: 'مرخصی استحقاقی روزانه', unit: 'day', deductsEntitlement: true, maxDaysPerYear: 30, sortOrder: 10,
    description: '۲.۵ روز در ماه، سالانه ۳۰ روز با احتساب ۴ جمعه (ماده ۶۴ و ۶۷ قانون کار).' },
  { ...base, code: 'entitlement_hourly', name: 'مرخصی ساعتی', unit: 'hour', deductsEntitlement: true, maxMinutesPerDay: 240, maxCountPerMonth: 5, sortOrder: 20,
    description: 'حداکثر ۴ ساعت در روز و ۵ نوبت در ماه؛ بیش از ۴ ساعت به مرخصی روزانه تبدیل می‌شود.' },
  { ...base, code: 'sick', name: 'مرخصی استعلاجی', unit: 'day', paid: false, requiresAttachment: true, sortOrder: 30,
    description: 'با گواهی پزشک و تأیید تأمین اجتماعی؛ حقوق از طرف شرکت پرداخت نمی‌شود (ماده ۷۴).' },
  { ...base, code: 'unpaid', name: 'مرخصی بدون حقوق', unit: 'day', paid: false, countsInnerHolidays: true, maxDaysPerYear: 30, sortOrder: 40,
    description: 'حداکثر ۱ ماه در سال؛ تا ۷ روز تأیید سرپرست و کمیته، بیش از آن مدیرعامل (ماده ۷۲).' },
  { ...base, code: 'lactation', name: 'مرخصی شیردهی', unit: 'hour', maxMinutesPerDay: 90, sortOrder: 50,
    description: 'تا ۲ سالگی کودک؛ جزو ساعات کار و بدون کسر از استحقاقی (ماده ۷۸). دوقلو ۲ ساعت.' },
  { ...base, code: 'maternity', name: 'مرخصی زایمان', unit: 'day', paid: false, countsInnerHolidays: true, requiresAttachment: true, maxDaysPerYear: 270, sortOrder: 60,
    description: '۹ ماه؛ پرداخت توسط سازمان تأمین اجتماعی (ماده ۷۶).' },
  { ...base, code: 'marriage_bereavement', name: 'مرخصی ازدواج و فوت', unit: 'day', countsInnerHolidays: true, requiresAttachment: true, maxDaysPerYear: 3, sortOrder: 70,
    description: '۳ روز برای ازدواج دائم یا فوت بستگان درجه یک؛ بدون کسر از استحقاقی (ماده ۷۳).' },
  { ...base, code: 'incentive', name: 'مرخصی تشویقی', unit: 'day', sortOrder: 80,
    description: 'با درخواست مدیر واحد و موافقت مدیرعامل برای تشویق کارکنان کوشا.' },
  { ...base, code: 'hajj', name: 'مرخصی حج', unit: 'day', deductsEntitlement: true, requiresAttachment: true, maxDaysPerYear: 30, sortOrder: 90,
    description: 'یک ماه برای حج تمتع واجب؛ از محل ۳۰ روز استحقاقی (ماده ۶۷).' },
  { ...base, code: 'study', name: 'مرخصی تحصیلی', unit: 'day', paid: false, countsInnerHolidays: true, sortOrder: 100,
    description: 'بدون حقوق با مجوز مدیرعامل؛ قابل تهاتر با اضافه‌کار.' },
  { ...base, code: 'exit_permit', name: 'مجوز خروج', unit: 'hour', maxMinutesPerDay: 10, maxCountPerWeek: 2, sortOrder: 110,
    description: 'حداکثر ۱۰ دقیقه و دو بار در هفته در زمان موظفی.' },
  { ...base, code: 'mission', name: 'مأموریت', unit: 'day', countsInnerHolidays: true, sortOrder: 120,
    description: 'مأموریت کاری خارج از محل؛ بدون کسر از مرخصی.' },
];
