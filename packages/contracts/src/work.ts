import { z } from 'zod';
import { Uuid } from './api.js';

// Request schemas of the M2 kernel: organisation, work calendar, workflow,
// kartabl and work tasks.

const isoDate = z.iso.date();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
const title = z.string().trim().min(1).max(300);
const body = z.string().max(10_000);

// ── organisation ─────────────────────────────────────────────────────────────
export const CreateOrgUnitRequest = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(200),
  parentId: Uuid.optional(),
  /** Defaults to the parent's, or to the tenant's only legal entity. */
  legalEntityId: Uuid.optional(),
  managerUserId: Uuid.optional(),
  workScheduleId: Uuid.optional(),
});
export type CreateOrgUnitRequest = z.infer<typeof CreateOrgUnitRequest>;

export const UpdateOrgUnitRequest = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  parentId: Uuid.nullable().optional(),
  managerUserId: Uuid.nullable().optional(),
  workScheduleId: Uuid.nullable().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateOrgUnitRequest = z.infer<typeof UpdateOrgUnitRequest>;

export const SetOrgUnitMemberRequest = z.object({ isPrimary: z.boolean().default(false) });
export type SetOrgUnitMemberRequest = z.infer<typeof SetOrgUnitMemberRequest>;

export interface OrgUnitSummary {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  legalEntityId: string;
  managerUserId: string | null;
  workScheduleId: string | null;
  isActive: boolean;
  depth: number;
  memberCount: number;
}

// ── work calendar ────────────────────────────────────────────────────────────
export const CreateHolidayRequest = z.object({
  date: isoDate,
  title: z.string().trim().min(1).max(200),
  isOfficial: z.boolean().default(false),
  isOff: z.boolean().default(true),
});
export type CreateHolidayRequest = z.infer<typeof CreateHolidayRequest>;

export const ImportOfficialHolidaysRequest = z.object({ jalaliYear: z.number().int().min(1350).max(1500) });
export type ImportOfficialHolidaysRequest = z.infer<typeof ImportOfficialHolidaysRequest>;

export const WorkScheduleRequest = z
  .object({
    name: z.string().trim().min(1).max(100),
    /** Iranian weekdays, 0 = Saturday … 6 = Friday. */
    workDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    startTime: hhmm,
    endTime: hhmm,
    isDefault: z.boolean().default(false),
  })
  .refine((v) => v.endTime > v.startTime, { message: 'endTime must be after startTime', path: ['endTime'] });
export type WorkScheduleRequest = z.infer<typeof WorkScheduleRequest>;

export const ScheduleOverrideRequest = z.object({
  date: isoDate,
  isWorking: z.boolean(),
  note: z.string().max(500).optional(),
});
export type ScheduleOverrideRequest = z.infer<typeof ScheduleOverrideRequest>;

export const CalendarRangeQuery = z
  .object({ from: isoDate, to: isoDate })
  .refine((v) => v.to >= v.from, { message: 'to must not be before from', path: ['to'] });
export type CalendarRangeQuery = z.infer<typeof CalendarRangeQuery>;

// ── workflow ─────────────────────────────────────────────────────────────────
export const DecideTaskRequest = z.object({
  decision: z.enum(['approve', 'reject']),
  comment: z.string().max(2000).optional(),
});
export type DecideTaskRequest = z.infer<typeof DecideTaskRequest>;

export interface ApprovalItem {
  taskId: string;
  instanceId: string;
  docType: string;
  docId: string;
  title: string | null;
  stepId: string;
  stepLabel: string | null;
  subjectUserId: string | null;
  subjectName: string | null;
  createdAt: string;
}

// ── kartabl ──────────────────────────────────────────────────────────────────
export const InboxStatus = z.enum(['open', 'in_progress', 'done', 'archived']);

export const CreateInboxItemRequest = z.object({
  /** Whose kartabl; omitted = your own. Someone else's needs core.inbox.assign. */
  ownerUserId: Uuid.optional(),
  kind: z.enum(['task', 'note', 'document']).default('task'),
  title,
  body: body.optional(),
  remindAt: z.iso.datetime({ offset: true }).optional(),
  folder: z.string().max(100).optional(),
});
export type CreateInboxItemRequest = z.infer<typeof CreateInboxItemRequest>;

export const UpdateInboxItemRequest = z.object({
  title: title.optional(),
  body: body.nullable().optional(),
  remindAt: z.iso.datetime({ offset: true }).nullable().optional(),
});
export type UpdateInboxItemRequest = z.infer<typeof UpdateInboxItemRequest>;

export const SetStatusRequest = z.object({ status: InboxStatus });

/** A message to a whole org unit or to chosen people. */
export const Recipients = z
  .object({
    userIds: z.array(Uuid).max(500).optional(),
    orgUnitId: Uuid.optional(),
    includeSubUnits: z.boolean().default(false),
  })
  .refine((v) => !!v.orgUnitId !== !!v.userIds?.length, {
    message: 'give either orgUnitId or userIds',
    path: ['userIds'],
  });

export const SendMessageRequest = z.object({ to: Recipients, title, body: body.optional() });
export type SendMessageRequest = z.infer<typeof SendMessageRequest>;

// ── work tasks (میز کار) ─────────────────────────────────────────────────────
export const TaskStatus = z.enum(['open', 'in_progress', 'done']);

export const CreateTaskRequest = z
  .object({
    to: Recipients,
    title: z.string().trim().min(2).max(300),
    body: body.optional(),
    code: z.string().max(50).optional(),
    priority: z.enum(['normal', 'urgent', 'forced']).default('normal'),
    fromDate: isoDate.optional(),
    dueDate: isoDate.optional(),
    parentId: Uuid.optional(),
  })
  .refine((v) => !v.fromDate || !v.dueDate || v.dueDate >= v.fromDate, {
    message: 'dueDate must not be before fromDate',
    path: ['dueDate'],
  });
export type CreateTaskRequest = z.infer<typeof CreateTaskRequest>;

export const SetTaskStatusRequest = z.object({ status: TaskStatus });
export const DelegateTaskRequest = z.object({ toUserId: Uuid });
