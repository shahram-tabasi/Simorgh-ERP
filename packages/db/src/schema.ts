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
  pgSchema,
  smallint,
  text,
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
