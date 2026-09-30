import 'reflect-metadata';
import type { Type } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { createTestDb, type TestDb } from '@simorgh/db/testing';

export { createTestDb, type TestDb };
import pg from 'pg';
import { AppModule } from '../src/app.module.js';
import { loadConfig, type Config } from '../src/config.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../src/kernel/files/object-storage.js';

/** In-memory object store; `put` stands in for the client's direct upload. */
export class MemoryStorage implements ObjectStorage {
  readonly objects = new Map<string, { size: number; sha256Hex: string }>();
  async presignPut(key: string) {
    return { url: `memory://put/${key}`, headers: {} };
  }
  async presignGet(key: string) {
    return `memory://get/${key}`;
  }
  async head(key: string) {
    return this.objects.get(key) ?? null;
  }
  async ensureBucket() {}
  put(key: string, size: number, sha256Hex: string) {
    this.objects.set(key, { size, sha256Hex });
  }
}

export interface Res {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

export interface TestApp {
  app: NestFastifyApplication;
  db: TestDb;
  config: Config;
  storage: ObjectStorage;
  owner: pg.Pool;
  request(method: string, url: string, opts?: { token?: string; body?: unknown }): Promise<Res>;
  close(): Promise<void>;
}

export async function createTestApp(
  opts: { storage?: ObjectStorage; env?: Record<string, string>; extraControllers?: Type[] } = {},
): Promise<TestApp> {
  const db = await createTestDb();
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: db.appUrl,
    JWT_SECRET: 'test-secret-test-secret-test-secret-0123',
    ...opts.env,
  });
  const storage = opts.storage ?? new MemoryStorage();

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(config)],
    controllers: opts.extraControllers ?? [],
  })
    .overrideProvider(OBJECT_STORAGE)
    .useValue(storage)
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const owner = new pg.Pool({ connectionString: db.ownerUrl, max: 2 });

  return {
    app,
    db,
    config,
    storage,
    owner,
    async request(method, url, o = {}) {
      const res = await app.inject({
        method: method as 'GET',
        url,
        headers: {
          ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
          ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(o.body !== undefined ? { payload: JSON.stringify(o.body) } : {}),
      });
      return { status: res.statusCode, body: res.body ? safeJson(res.body) : null };
    },
    async close() {
      await app.close();
      await owner.end();
      await db.drop();
    },
  };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

// ── fixtures ────────────────────────────────────────────────────────────────

export const PLATFORM_ADMIN = { email: 'admin@simorgh.test', password: 'admin-pass-123' };

export async function seedPlatformAdmin(t: TestApp): Promise<void> {
  const { hash } = await import('@node-rs/argon2');
  await t.owner.query(
    `INSERT INTO core.users (email, display_name, password_hash, is_platform_admin) VALUES ($1, 'Admin', $2, true)`,
    [PLATFORM_ADMIN.email, await hash(PLATFORM_ADMIN.password)],
  );
}

export async function login(t: TestApp, email: string, password: string, tenant?: string) {
  const res = await t.request('POST', '/api/v1/auth/login', { body: { email, password, ...(tenant ? { tenant } : {}) } });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { accessToken: string; refreshToken: string };
}

export async function platformToken(t: TestApp): Promise<string> {
  return (await login(t, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password)).accessToken;
}

export interface TenantFixture {
  id: string;
  code: string;
  legalEntityId: string;
  ownerId: string;
  ownerEmail: string;
  ownerToken: string;
}

export async function provisionTenant(t: TestApp, pt: string, code: string): Promise<TenantFixture> {
  const ownerEmail = `owner@${code}.test`;
  const res = await t.request('POST', '/api/v1/platform/tenants', {
    token: pt,
    body: {
      code,
      name: `Tenant ${code}`,
      legalEntity: { code: code.toUpperCase(), name: `${code} Co` },
      owner: { email: ownerEmail, displayName: `Owner ${code}`, password: 'owner-pass-123' },
    },
  });
  if (res.status !== 201) throw new Error(`provision failed: ${res.status} ${JSON.stringify(res.body)}`);
  const ownerToken = (await login(t, ownerEmail, 'owner-pass-123', code)).accessToken;
  return { id: res.body.id, code, legalEntityId: res.body.legalEntityId, ownerId: res.body.ownerUserId, ownerEmail, ownerToken };
}

/** Adds a member with a password and returns their tenant token. */
export async function addMember(t: TestApp, tenant: TenantFixture, email: string): Promise<{ userId: string; token: string }> {
  const res = await t.request('POST', '/api/v1/core/members', {
    token: tenant.ownerToken,
    body: { email, displayName: email.split('@')[0], password: 'member-pass-123' },
  });
  if (res.status !== 201) throw new Error(`add member failed: ${res.status} ${JSON.stringify(res.body)}`);
  const token = (await login(t, email, 'member-pass-123', tenant.code)).accessToken;
  return { userId: res.body.userId, token };
}

/** Creates a role with these grants and gives it to `userId` (optionally in an org-unit or legal-entity context). */
export async function grantRole(
  t: TestApp,
  tenant: TenantFixture,
  userId: string,
  key: string,
  permissions: { key: string; scope: string }[],
  context?: { type: 'org_unit' | 'legal_entity'; id: string },
): Promise<void> {
  const roles = await t.request('GET', '/api/v1/core/roles', { token: tenant.ownerToken });
  let role = roles.body.find((r: { key: string }) => r.key === key);
  if (!role) {
    const created = await t.request('POST', '/api/v1/core/roles', { token: tenant.ownerToken, body: { key, name: key, permissions } });
    if (created.status !== 201) throw new Error(`role failed: ${created.status} ${JSON.stringify(created.body)}`);
    role = created.body;
  }
  const assigned = await t.request('POST', `/api/v1/core/members/${userId}/roles`, {
    token: tenant.ownerToken,
    body: { roleId: role.id, ...(context ? { contextType: context.type, contextId: context.id } : {}) },
  });
  if (assigned.status !== 201) throw new Error(`assign failed: ${assigned.status} ${JSON.stringify(assigned.body)}`);
}

/** Creates an org unit as the tenant owner and returns its id. */
export async function orgUnit(
  t: TestApp,
  tenant: TenantFixture,
  body: { code: string; name?: string; parentId?: string; managerUserId?: string },
): Promise<string> {
  const r = await t.request('POST', '/api/v1/core/org-units', { token: tenant.ownerToken, body: { name: body.code, ...body } });
  if (r.status !== 201) throw new Error(`org unit failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.id;
}

export async function joinUnit(t: TestApp, tenant: TenantFixture, unitId: string, userId: string): Promise<void> {
  const r = await t.request('PUT', `/api/v1/core/org-units/${unitId}/members/${userId}`, { token: tenant.ownerToken, body: {} });
  if (r.status !== 200) throw new Error(`join failed: ${r.status} ${JSON.stringify(r.body)}`);
}
