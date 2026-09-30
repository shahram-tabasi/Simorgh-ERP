// Drizzle definitions of the kernel tables the application reads and writes.
// The DDL itself lives in ../migrations (SQL-first, ADR-06); these mirror it.
// A table the code does not use yet is left out rather than guessed at.
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  customType,
  date,
  inet,
  integer,
  jsonb,
  numeric,
  pgSchema,
  smallint,
  text,
  time,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const citext = customType<{ data: string }>({ dataType: () => 'citext' });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const id = () => uuid('id').primaryKey().default(sql`core.uuid_v7()`);

export const core = pgSchema('core');

export const tenants = core.table('tenants', {
  id: id(),
  code: citext('code').notNull(),
  name: text('name').notNull(),
  status: text('status').$type<'trial' | 'active' | 'suspended' | 'closed'>().notNull().default('active'),
  planId: uuid('plan_id'),
  deploymentMode: text('deployment_mode').$type<'pooled' | 'dedicated' | 'on_prem'>().notNull().default('pooled'),
  defaultLocale: text('default_locale').notNull().default('fa-IR'),
  defaultTimezone: text('default_timezone').notNull().default('Asia/Tehran'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const users = core.table('users', {
  id: id(),
  email: citext('email'),
  mobile: text('mobile'),
  passwordHash: text('password_hash'),
  displayName: text('display_name').notNull(),
  locale: text('locale'),
  mfaTotpSecret: text('mfa_totp_secret'),
  isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
  lockedUntil: ts('locked_until'),
  lastLoginAt: ts('last_login_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const refreshTokens = core.table('refresh_tokens', {
  id: id(),
  userId: uuid('user_id').notNull(),
  sessionTenantId: uuid('session_tenant_id'),
  familyId: uuid('family_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  deviceInfo: jsonb('device_info'),
  ipAddress: inet('ip_address'),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const loginAttempts = core.table('login_attempts', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  identifier: text('identifier').notNull(),
  ipAddress: inet('ip_address'),
  success: boolean('success').notNull(),
  reason: text('reason'),
  at: ts('at').notNull().defaultNow(),
});

export const legalEntities = core.table('legal_entities', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  nationalId: text('national_id'),
  economicCode: text('economic_code'),
  registrationNo: text('registration_no'),
  baseCurrency: char('base_currency', { length: 3 }).notNull().default('IRR'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const tenantMemberships = core.table('tenant_memberships', {
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  partyId: uuid('party_id'),
  status: text('status').$type<'invited' | 'active' | 'disabled'>().notNull().default('active'),
  isOwner: boolean('is_owner').notNull().default(false),
  permVer: integer('perm_ver').notNull().default(1),
  joinedAt: ts('joined_at').notNull().defaultNow(),
});

export const permissions = core.table('permissions', {
  key: text('key').primaryKey(),
  module: text('module').notNull(),
  labelFa: text('label_fa').notNull(),
  labelEn: text('label_en').notNull(),
  scopes: text('scopes').array().notNull(),
});

export const roles = core.table('roles', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  key: text('key').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  isSystem: boolean('is_system').notNull().default(false),
});

export type Scope = 'own' | 'org_unit' | 'project' | 'legal_entity' | 'tenant';
export type ContextType = 'tenant' | 'legal_entity' | 'org_unit' | 'project';

export const rolePermissions = core.table('role_permissions', {
  tenantId: uuid('tenant_id').notNull(),
  roleId: uuid('role_id').notNull(),
  permissionKey: text('permission_key').notNull(),
  scope: text('scope').$type<Scope>().notNull().default('tenant'),
});

export const userRoles = core.table('user_roles', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  roleId: uuid('role_id').notNull(),
  contextType: text('context_type').$type<ContextType>().notNull().default('tenant'),
  contextId: uuid('context_id'),
  validUntil: date('valid_until', { mode: 'string' }),
});

export const numberSeries = core.table('number_series', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  docType: text('doc_type').notNull(),
  legalEntityId: uuid('legal_entity_id'),
  periodKey: text('period_key').notNull().default(''),
  prefix: text('prefix').notNull(),
  padding: smallint('padding').notNull().default(6),
  nextValue: bigint('next_value', { mode: 'number' }).notNull().default(1),
  gapless: boolean('gapless').notNull().default(false),
});

export const attachments = core.table('attachments', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  ownerType: text('owner_type').notNull(),
  ownerId: uuid('owner_id').notNull(),
  category: text('category'),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  sha256: char('sha256', { length: 64 }).notNull(),
  storageKey: text('storage_key').notNull(),
  status: text('status').$type<'pending' | 'stored'>().notNull().default('pending'),
  version: integer('version').notNull().default(1),
  createdAt: ts('created_at').notNull().defaultNow(),
  createdBy: uuid('created_by'),
});

export type ActorVia = 'web' | 'api' | 'agent' | 'system' | 'integration';

export const auditLog = core.table('audit_log', {
  id: uuid('id').notNull().default(sql`core.uuid_v7()`),
  tenantId: uuid('tenant_id'),
  at: ts('at').notNull().defaultNow(),
  actorUserId: uuid('actor_user_id'),
  actorVia: text('actor_via').$type<ActorVia>().notNull().default('web'),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id'),
  before: jsonb('before'),
  after: jsonb('after'),
  ipAddress: inet('ip_address'),
  correlationId: uuid('correlation_id'),
});

export const outboxEvents = core.table('outbox_events', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  type: text('type').notNull(),
  version: smallint('version').notNull().default(1),
  subjectType: text('subject_type').notNull(),
  subjectId: uuid('subject_id').notNull(),
  payload: jsonb('payload').notNull(),
  correlationId: uuid('correlation_id'),
  occurredAt: ts('occurred_at').notNull().defaultNow(),
  publishedAt: ts('published_at'),
  attempts: integer('attempts').notNull().default(0),
});

export const inboxEvents = core.table('inbox_events', {
  consumer: text('consumer').notNull(),
  eventId: uuid('event_id').notNull(),
  processedAt: ts('processed_at').notNull().defaultNow(),
});

// ── organisation (0004) ─────────────────────────────────────────────────────

const ltree = customType<{ data: string }>({ dataType: () => 'ltree' });

export const orgUnits = core.table('org_units', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  legalEntityId: uuid('legal_entity_id').notNull(),
  parentId: uuid('parent_id'),
  code: text('code').notNull(),
  name: text('name').notNull(),
  /** Maintained by a trigger from parent_id; never written by the application. */
  path: ltree('path').notNull(),
  managerUserId: uuid('manager_user_id'),
  workScheduleId: uuid('work_schedule_id'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const orgUnitMembers = core.table('org_unit_members', {
  tenantId: uuid('tenant_id').notNull(),
  orgUnitId: uuid('org_unit_id').notNull(),
  userId: uuid('user_id').notNull(),
  isPrimary: boolean('is_primary').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
});

// ── work calendar (0004) ────────────────────────────────────────────────────

export const holidays = core.table('holidays', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  holidayDate: date('holiday_date', { mode: 'string' }).notNull(),
  title: text('title').notNull(),
  isOfficial: boolean('is_official').notNull().default(true),
  isOff: boolean('is_off').notNull().default(true),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const workSchedules = core.table('work_schedules', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  workDays: smallint('work_days').array().notNull(),
  startTime: time('start_time').notNull(),
  endTime: time('end_time').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const scheduleOverrides = core.table('schedule_overrides', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  overrideDate: date('override_date', { mode: 'string' }).notNull(),
  isWorking: boolean('is_working').notNull(),
  note: text('note'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

// ── workflow (0001 + 0004) ──────────────────────────────────────────────────

export const wfDefinitions = core.table('wf_definitions', {
  id: id(),
  tenantId: uuid('tenant_id'),
  key: text('key').notNull(),
  version: integer('version').notNull(),
  docType: text('doc_type').notNull(),
  definition: jsonb('definition').notNull(),
  source: text('source').$type<'shipped' | 'tenant'>().notNull().default('shipped'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export type WfInstanceStatus = 'running' | 'approved' | 'rejected' | 'cancelled';

export const wfInstances = core.table('wf_instances', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  definitionId: uuid('definition_id').notNull(),
  docType: text('doc_type').notNull(),
  docId: uuid('doc_id').notNull(),
  status: text('status').$type<WfInstanceStatus>().notNull().default('running'),
  currentStep: text('current_step'),
  context: jsonb('context').$type<Record<string, unknown>>().notNull().default({}),
  subjectUserId: uuid('subject_user_id'),
  title: text('title'),
  outcomeComment: text('outcome_comment'),
  startedAt: ts('started_at').notNull().defaultNow(),
  startedBy: uuid('started_by'),
  finishedAt: ts('finished_at'),
});

export type WfTaskStatus = 'open' | 'approved' | 'rejected' | 'returned' | 'delegated' | 'cancelled' | 'expired';

export const wfTasks = core.table('wf_tasks', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  instanceId: uuid('instance_id').notNull(),
  stepId: text('step_id').notNull(),
  stepNo: integer('step_no').notNull().default(1),
  assigneeUserId: uuid('assignee_user_id'),
  assigneeRoleId: uuid('assignee_role_id'),
  assigneePermission: text('assignee_permission'),
  assigneeRule: text('assignee_rule'),
  delegatedFrom: uuid('delegated_from'),
  status: text('status').$type<WfTaskStatus>().notNull().default('open'),
  dueAt: ts('due_at'),
  decidedAt: ts('decided_at'),
  decidedBy: uuid('decided_by'),
  comment: text('comment'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const wfHistory = core.table('wf_history', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  instanceId: uuid('instance_id').notNull(),
  stepId: text('step_id'),
  action: text('action').$type<'start' | 'activate' | 'approve' | 'reject' | 'cancel' | 'complete'>().notNull(),
  actorUserId: uuid('actor_user_id'),
  comment: text('comment'),
  data: jsonb('data'),
  at: ts('at').notNull().defaultNow(),
});

// ── kartabl and work tasks (0004) ───────────────────────────────────────────

export type InboxStatus = 'open' | 'in_progress' | 'done' | 'archived';

export const inboxItems = core.table('inbox_items', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  ownerUserId: uuid('owner_user_id').notNull(),
  folder: text('folder'),
  kind: text('kind').$type<'task' | 'note' | 'message' | 'document'>().notNull().default('task'),
  title: text('title').notNull(),
  body: text('body'),
  status: text('status').$type<InboxStatus>().notNull().default('open'),
  refType: text('ref_type'),
  refId: uuid('ref_id'),
  createdBy: uuid('created_by'),
  remindAt: ts('remind_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const tasks = core.table('tasks', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  code: text('code'),
  priority: text('priority').$type<'normal' | 'urgent' | 'forced'>().notNull().default('normal'),
  fromDate: date('from_date', { mode: 'string' }),
  dueDate: date('due_date', { mode: 'string' }),
  createdBy: uuid('created_by'),
  orgUnitId: uuid('org_unit_id'),
  parentId: uuid('parent_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export type TaskStatus = 'open' | 'in_progress' | 'done';

export const taskAssignees = core.table('task_assignees', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  taskId: uuid('task_id').notNull(),
  userId: uuid('user_id').notNull(),
  status: text('status').$type<TaskStatus>().notNull().default('open'),
  delegatedFrom: uuid('delegated_from'),
  acknowledgedAt: ts('acknowledged_at'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

// ── hcm (0005) ──────────────────────────────────────────────────────────────

export const hcm = pgSchema('hcm');

export type Site = 'hq' | 'factory' | 'guard';

export const employments = hcm.table('employments', {
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  hireDate: date('hire_date', { mode: 'string' }).notNull(),
  site: text('site').$type<Site>().notNull().default('hq'),
  dailyWorkMinutes: integer('daily_work_minutes').notNull().default(510),
  workScheduleId: uuid('work_schedule_id'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const leavePolicies = hcm.table('leave_policies', {
  tenantId: uuid('tenant_id').primaryKey(),
  annualLeaveDays: numeric('annual_leave_days', { mode: 'number' }).notNull().default(26),
  maxNegativeDays: numeric('max_negative_days', { mode: 'number' }).notNull().default(3),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const leaveTypes = hcm.table('leave_types', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  unit: text('unit').$type<'day' | 'hour'>().notNull(),
  paid: boolean('paid').notNull().default(true),
  deductsEntitlement: boolean('deducts_entitlement').notNull().default(false),
  countsInnerHolidays: boolean('counts_inner_holidays').notNull().default(false),
  requiresAttachment: boolean('requires_attachment').notNull().default(false),
  maxMinutesPerDay: integer('max_minutes_per_day'),
  maxCountPerMonth: integer('max_count_per_month'),
  maxCountPerWeek: integer('max_count_per_week'),
  maxDaysPerYear: numeric('max_days_per_year', { mode: 'number' }),
  approvalLevels: integer('approval_levels').notNull().default(2),
  isActive: boolean('is_active').notNull().default(true),
  isSystem: boolean('is_system').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(100),
  description: text('description'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export const leaveRequests = hcm.table('leave_requests', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  typeId: uuid('type_id').notNull(),
  kind: text('kind').$type<'leave' | 'mission' | 'hourly'>().notNull(),
  fromDate: date('from_date', { mode: 'string' }).notNull(),
  toDate: date('to_date', { mode: 'string' }).notNull(),
  fromTime: time('from_time'),
  toTime: time('to_time'),
  jalaliYear: integer('jalali_year').notNull(),
  effectiveDays: numeric('effective_days', { mode: 'number' }).notNull(),
  reason: text('reason'),
  attachmentId: uuid('attachment_id'),
  details: jsonb('details'),
  status: text('status').$type<LeaveStatus>().notNull().default('pending'),
  workflowInstanceId: uuid('workflow_instance_id'),
  decidedBy: uuid('decided_by'),
  decidedAt: ts('decided_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const leaveLedger = hcm.table('leave_ledger', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  jalaliYear: integer('jalali_year').notNull(),
  kind: text('kind').$type<'carry_in' | 'forfeit' | 'buyback' | 'adjust'>().notNull(),
  days: numeric('days', { mode: 'number' }).notNull(),
  note: text('note'),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});
