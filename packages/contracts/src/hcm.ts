import { z } from 'zod';
import { Uuid } from './api.js';
import { definePermissions } from './permissions.js';

/** Permissions of the HCM module. Approval steps follow Kara: unit manager → HR → final. */
export const HCM_PERMISSIONS = definePermissions('hcm', {
  'leave.view': {
    fa: 'مشاهده مرخصی و ماندهٔ دیگران',
    en: "View other people's leave and balances",
    scopes: ['org_unit', 'legal_entity', 'tenant'],
  },
  'leave.approve': {
    fa: 'تأیید مرخصی (مدیر بخش)',
    en: 'Approve leave (unit manager)',
    scopes: ['org_unit', 'legal_entity', 'tenant'],
  },
  'leave.approve.hr': {
    fa: 'تأیید مرخصی (کارگزینی)',
    en: 'Approve leave (HR)',
    scopes: ['org_unit', 'legal_entity', 'tenant'],
  },
  'leave.approve.final': {
    fa: 'تأیید نهایی مرخصی (مدیرعامل)',
    en: 'Approve leave (final)',
    scopes: ['legal_entity', 'tenant'],
  },
  'leave_type.manage': { fa: 'مدیریت انواع مرخصی و قواعد آن', en: 'Manage leave types and their rules' },
  'leave_ledger.manage': {
    fa: 'ثبت انتقال، بازخرید و اصلاح ماندهٔ مرخصی',
    en: 'Record carry-over, buy-back and balance corrections',
    scopes: ['org_unit', 'legal_entity', 'tenant'],
  },
  'employment.manage': {
    fa: 'مدیریت اطلاعات استخدامی (تاریخ استخدام، محل کار)',
    en: 'Manage employment profiles',
    scopes: ['org_unit', 'legal_entity', 'tenant'],
  },
  'policy.manage': { fa: 'مدیریت آیین‌نامهٔ حضور و مرخصی', en: 'Manage the attendance and leave policy' },
});

export const HcmEvents = {
  leaveRequested: 'hcm.leave.requested',
  leaveApproved: 'hcm.leave.approved',
  leaveRejected: 'hcm.leave.rejected',
  leaveCancelled: 'hcm.leave.cancelled',
} as const;

const isoDate = z.iso.date();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');

export const LeaveTypeRequest = z.object({
  code: z.string().regex(/^[a-z][a-z0-9_]{1,49}$/),
  name: z.string().trim().min(2).max(200),
  unit: z.enum(['day', 'hour']),
  paid: z.boolean().default(true),
  deductsEntitlement: z.boolean().default(false),
  countsInnerHolidays: z.boolean().default(false),
  requiresAttachment: z.boolean().default(false),
  maxMinutesPerDay: z.number().int().min(1).max(1440).nullable().default(null),
  maxCountPerMonth: z.number().int().min(1).max(100).nullable().default(null),
  maxCountPerWeek: z.number().int().min(1).max(50).nullable().default(null),
  maxDaysPerYear: z.number().min(0.5).max(366).nullable().default(null),
  approvalLevels: z.number().int().min(1).max(3).default(2),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(100),
  description: z.string().max(1000).optional(),
});
export type LeaveTypeRequest = z.infer<typeof LeaveTypeRequest>;
export const UpdateLeaveTypeRequest = LeaveTypeRequest.omit({ code: true }).partial();
export type UpdateLeaveTypeRequest = z.infer<typeof UpdateLeaveTypeRequest>;

export const MissionDetails = z
  .object({
    subtype: z.string().max(100),
    origin: z.string().trim().min(1).max(100),
    destination: z.string().trim().min(1).max(100),
    transportGo: z.string().max(100),
    transportBack: z.string().max(100),
    startTime: hhmm,
    endTime: hhmm,
    subject: z.string().max(500),
    project: z.string().max(200),
    oe: z.string().max(100),
    visitPlace: z.string().max(200),
    substitute: z.string().max(200),
    clientRequest: z.boolean(),
  })
  .partial()
  .required({ origin: true, destination: true });

export const SubmitLeaveRequest = z.object({
  typeId: Uuid,
  fromDate: isoDate,
  /** Day-unit leave; defaults to fromDate. */
  toDate: isoDate.optional(),
  /** Hour-unit leave. */
  fromTime: hhmm.optional(),
  toTime: hhmm.optional(),
  reason: z.string().max(2000).optional(),
  /** An attachment already uploaded through /core/attachments (medical certificate, …). */
  attachmentId: Uuid.optional(),
  mission: MissionDetails.optional(),
});
export type SubmitLeaveRequest = z.infer<typeof SubmitLeaveRequest>;

export const LeaveListQuery = z.object({
  /** Someone else's requests need hcm.leave.view covering them. */
  userId: Uuid.optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type LeaveListQuery = z.infer<typeof LeaveListQuery>;

export const BalanceQuery = z.object({
  userId: Uuid.optional(),
  jalaliYear: z.coerce.number().int().min(1350).max(1500).optional(),
});
export type BalanceQuery = z.infer<typeof BalanceQuery>;

export const EmploymentRequest = z.object({
  hireDate: isoDate,
  site: z.enum(['hq', 'factory', 'guard']).default('hq'),
  /** Minutes that make one leave day; defaults by site (hq 510, factory 440, guard 510). */
  dailyWorkMinutes: z.number().int().min(60).max(1440).optional(),
  workScheduleId: Uuid.nullable().optional(),
});
export type EmploymentRequest = z.infer<typeof EmploymentRequest>;

export const LedgerEntryRequest = z.object({
  userId: Uuid,
  jalaliYear: z.number().int().min(1350).max(1500),
  kind: z.enum(['carry_in', 'forfeit', 'buyback', 'adjust']),
  /** Signed: + adds to the balance, − takes away. */
  days: z.number().min(-366).max(366).refine((d) => d !== 0, 'must not be zero'),
  note: z.string().max(500).optional(),
});
export type LedgerEntryRequest = z.infer<typeof LedgerEntryRequest>;

export const LeavePolicyRequest = z.object({
  annualLeaveDays: z.number().min(0).max(60),
  maxNegativeDays: z.number().min(0).max(30),
});
export type LeavePolicyRequest = z.infer<typeof LeavePolicyRequest>;

export interface LeaveBalance {
  userId: string;
  jalaliYear: number;
  hireDate: string | null;
  dailyWorkMinutes: number;
  annual: number;
  accrued: number;
  used: number;
  pending: number;
  carriedIn: number;
  adjustments: number;
  remaining: number;
}
