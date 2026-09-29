import { z } from 'zod';
import { SCOPES } from './permissions.js';

// ── common ───────────────────────────────────────────────────────────────────
export const Uuid = z.uuid();
const code = z.string().regex(/^[a-z0-9][a-z0-9-]{1,49}$/, 'lowercase letters, digits and dashes');
const password = z.string().min(10, 'at least 10 characters').max(200);

// ── auth ─────────────────────────────────────────────────────────────────────
export const LoginRequest = z.object({
  /** Tenant code; omitted for a platform (Simorgh) administrator. */
  tenant: code.optional(),
  email: z.email(),
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const RefreshRequest = z.object({ refreshToken: z.string().min(20).max(500) });
export type RefreshRequest = z.infer<typeof RefreshRequest>;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
}

export interface MeResponse {
  user: { id: string; email: string | null; displayName: string; isPlatformAdmin: boolean };
  tenant: { id: string; code: string; name: string } | null;
  permissions: string[];
}

// ── platform: tenants ────────────────────────────────────────────────────────
export const CreateTenantRequest = z.object({
  code,
  name: z.string().min(2).max(200),
  legalEntity: z.object({
    code: z.string().min(1).max(30),
    name: z.string().min(2).max(200),
    nationalId: z.string().max(20).optional(),
    economicCode: z.string().max(20).optional(),
    baseCurrency: z.string().length(3).default('IRR'),
  }),
  owner: z.object({
    email: z.email(),
    displayName: z.string().min(2).max(200),
    /** Required when the owner has no Simorgh account yet. */
    password: password.optional(),
  }),
});
export type CreateTenantRequest = z.infer<typeof CreateTenantRequest>;

export interface TenantSummary {
  id: string;
  code: string;
  name: string;
  status: string;
  createdAt: string;
}

// ── members ──────────────────────────────────────────────────────────────────
export const AddMemberRequest = z.object({
  email: z.email(),
  displayName: z.string().min(2).max(200),
  /** Only used when the person has no Simorgh account yet. */
  password: password.optional(),
});
export type AddMemberRequest = z.infer<typeof AddMemberRequest>;

export const AssignRoleRequest = z
  .object({
    roleId: Uuid,
    contextType: z.enum(['tenant', 'legal_entity', 'org_unit', 'project']).default('tenant'),
    contextId: Uuid.optional(),
    validUntil: z.iso.date().optional(),
  })
  .refine((v) => (v.contextType === 'tenant') === (v.contextId === undefined), {
    message: 'contextId is required for a non-tenant context, and forbidden for tenant',
    path: ['contextId'],
  });
export type AssignRoleRequest = z.infer<typeof AssignRoleRequest>;

export interface MemberSummary {
  userId: string;
  email: string | null;
  displayName: string;
  status: string;
  isOwner: boolean;
  roles: { assignmentId: string; roleId: string; roleKey: string; contextType: string; contextId: string | null }[];
}

// ── roles ────────────────────────────────────────────────────────────────────
export const RoleGrant = z.object({ key: z.string().min(3).max(100), scope: z.enum(SCOPES).default('tenant') });
export const CreateRoleRequest = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,49}$/),
  name: z.string().min(2).max(200),
  description: z.string().max(1000).optional(),
  permissions: z.array(RoleGrant).default([]),
});
export type CreateRoleRequest = z.infer<typeof CreateRoleRequest>;
export const SetRolePermissionsRequest = z.object({ permissions: z.array(RoleGrant) });
export type SetRolePermissionsRequest = z.infer<typeof SetRolePermissionsRequest>;

export interface RoleSummary {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: { key: string; scope: string }[];
}

// ── number series ────────────────────────────────────────────────────────────
export const CreateNumberSeriesRequest = z.object({
  docType: z.string().regex(/^[a-z_]+\.[a-z_]+$/),
  legalEntityId: Uuid.optional(),
  periodKey: z.string().max(20).default(''),
  prefix: z.string().min(1).max(30),
  padding: z.number().int().min(1).max(12).default(6),
  gapless: z.boolean().default(false),
});
export type CreateNumberSeriesRequest = z.infer<typeof CreateNumberSeriesRequest>;

// ── attachments ──────────────────────────────────────────────────────────────
export const CreateUploadRequest = z.object({
  ownerType: z.string().regex(/^[a-z_]+\.[a-z_]+$/),
  ownerId: Uuid,
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(3).max(150),
  sizeBytes: z.number().int().positive().max(2 * 1024 ** 3),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  category: z.string().max(50).optional(),
});
export type CreateUploadRequest = z.infer<typeof CreateUploadRequest>;

export interface UploadTicket {
  attachmentId: string;
  uploadUrl: string;
  /** Headers the client must send with the PUT. */
  headers: Record<string, string>;
  expiresIn: number;
}

// ── errors (RFC 9457) ────────────────────────────────────────────────────────
export interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  errors?: { path: string; message: string }[];
}
