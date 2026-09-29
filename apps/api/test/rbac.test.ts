import { Controller, Get } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, createTestApp, platformToken, provisionTenant, seedPlatformAdmin, type TenantFixture, type TestApp } from './harness.js';

// A route that forgot to say who may call it.
@Controller('api/v1/test/undeclared')
class UndeclaredController {
  @Get()
  get() {
    return { leaked: true };
  }
}

describe('RBAC, provisioning and tenant isolation', () => {
  let t: TestApp;
  let pt: string;
  let acme: TenantFixture;
  let globex: TenantFixture;

  beforeAll(async () => {
    t = await createTestApp({ extraControllers: [UndeclaredController] });
    await seedPlatformAdmin(t);
    pt = await platformToken(t);
    acme = await provisionTenant(t, pt, 'acme');
    globex = await provisionTenant(t, pt, 'globex');
  });
  afterAll(() => t.close());

  const roleByKey = async (tenant: TenantFixture, key: string) =>
    (await t.request('GET', '/api/v1/core/roles', { token: tenant.ownerToken })).body.find((r: { key: string }) => r.key === key);

  describe('provisioning', () => {
    it('creates the legal entity, system roles and an owner with every permission', async () => {
      const les = await t.request('GET', '/api/v1/core/legal-entities', { token: acme.ownerToken });
      expect(les.body).toHaveLength(1);
      expect(les.body[0]).toMatchObject({ code: 'ACME', baseCurrency: 'IRR' });
      const roles = await t.request('GET', '/api/v1/core/roles', { token: acme.ownerToken });
      expect(roles.body.map((r: { key: string; isSystem: boolean }) => [r.key, r.isSystem])).toEqual([
        ['admin', true],
        ['member', true],
      ]);
    });

    it('refuses a duplicate tenant code', async () => {
      const r = await t.request('POST', '/api/v1/platform/tenants', {
        token: pt,
        body: { code: 'acme', name: 'Acme again', legalEntity: { code: 'X', name: 'xx' }, owner: { email: 'z@z.test', displayName: 'zz', password: 'owner-pass-123' } },
      });
      expect(r.status).toBe(409);
    });

    it('rolls the whole tenant back when any part fails', async () => {
      const r = await t.request('POST', '/api/v1/platform/tenants', {
        token: pt,
        body: { code: 'half', name: 'Half', legalEntity: { code: 'H', name: 'Half Co' }, owner: { email: 'new@half.test', displayName: 'New' } },
      });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('OWNER_PASSWORD_REQUIRED');
      const left = await t.owner.query(`select count(*)::int n from core.tenants where code = 'half'`);
      expect(left.rows[0].n).toBe(0);
    });

    it('lets an existing Simorgh user own a second tenant without resetting their password', async () => {
      const r = await t.request('POST', '/api/v1/platform/tenants', {
        token: pt,
        body: { code: 'initech', name: 'Initech', legalEntity: { code: 'I', name: 'Initech Co' }, owner: { email: acme.ownerEmail, displayName: 'Someone', password: 'attacker-chosen-1' } },
      });
      expect(r.status).toBe(201);
      expect(r.body.ownerUserId).toBe(acme.ownerId);
      const ok = await t.request('POST', '/api/v1/auth/login', { body: { email: acme.ownerEmail, password: 'owner-pass-123', tenant: 'initech' } });
      expect(ok.status).toBe(200);
    });

    it('is only for platform administrators in a platform session', async () => {
      const r = await t.request('POST', '/api/v1/platform/tenants', { token: acme.ownerToken, body: {} });
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('PLATFORM_ADMIN_REQUIRED');
    });
  });

  describe('permissions', () => {
    let alice: { userId: string; token: string };

    beforeAll(async () => {
      alice = await addMember(t, acme, 'alice@acme.test');
    });

    it('a new member has no permissions and is refused', async () => {
      const r = await t.request('GET', '/api/v1/core/members', { token: alice.token });
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('MISSING_PERMISSION');
    });

    it('granting a role takes effect on the very next request', async () => {
      const viewer = await t.request('POST', '/api/v1/core/roles', {
        token: acme.ownerToken,
        body: { key: 'viewer', name: 'Viewer', permissions: [{ key: 'core.member.view', scope: 'tenant' }] },
      });
      expect(viewer.status).toBe(201);
      const assign = await t.request('POST', `/api/v1/core/members/${alice.userId}/roles`, {
        token: acme.ownerToken,
        body: { roleId: viewer.body.id },
      });
      expect(assign.status).toBe(201);

      expect((await t.request('GET', '/api/v1/core/members', { token: alice.token })).status).toBe(200);
      // viewing is not managing
      expect((await t.request('POST', '/api/v1/core/members', { token: alice.token, body: { email: 'x@x.test', displayName: 'xx' } })).status).toBe(403);
    });

    it('changing a role’s permissions changes its holders immediately', async () => {
      const viewer = await roleByKey(acme, 'viewer');
      const r = await t.request('PUT', `/api/v1/core/roles/${viewer.id}/permissions`, {
        token: acme.ownerToken,
        body: { permissions: [{ key: 'core.role.view', scope: 'tenant' }] },
      });
      expect(r.status).toBe(200);
      expect((await t.request('GET', '/api/v1/core/members', { token: alice.token })).status).toBe(403);
      expect((await t.request('GET', '/api/v1/core/roles', { token: alice.token })).status).toBe(200);
    });

    it('rejects unknown permissions and scopes a permission does not allow', async () => {
      const unknown = await t.request('POST', '/api/v1/core/roles', {
        token: acme.ownerToken,
        body: { key: 'bad', name: 'Bad', permissions: [{ key: 'core.nuclear.launch', scope: 'tenant' }] },
      });
      expect(unknown.body.code).toBe('UNKNOWN_PERMISSION');
      const scope = await t.request('POST', '/api/v1/core/roles', {
        token: acme.ownerToken,
        body: { key: 'bad', name: 'Bad', permissions: [{ key: 'core.role.view', scope: 'own' }] },
      });
      expect(scope.body.code).toBe('SCOPE_NOT_ALLOWED');
    });

    it('system roles cannot be edited or deleted', async () => {
      const admin = await roleByKey(acme, 'admin');
      expect((await t.request('PUT', `/api/v1/core/roles/${admin.id}/permissions`, { token: acme.ownerToken, body: { permissions: [] } })).body.code).toBe('ROLE_IS_SYSTEM');
      expect((await t.request('DELETE', `/api/v1/core/roles/${admin.id}`, { token: acme.ownerToken })).body.code).toBe('ROLE_IS_SYSTEM');
    });

    it('the owner cannot be disabled or lose the administrator role', async () => {
      expect((await t.request('PATCH', `/api/v1/core/members/${acme.ownerId}`, { token: acme.ownerToken, body: { status: 'disabled' } })).body.code).toBe('OWNER_PROTECTED');
      const members = await t.request('GET', '/api/v1/core/members', { token: acme.ownerToken });
      const owner = members.body.find((m: { userId: string }) => m.userId === acme.ownerId);
      const adminAssignment = owner.roles.find((r: { roleKey: string }) => r.roleKey === 'admin');
      expect(
        (await t.request('DELETE', `/api/v1/core/members/${acme.ownerId}/roles/${adminAssignment.assignmentId}`, { token: acme.ownerToken })).body.code,
      ).toBe('OWNER_PROTECTED');
    });

    it('disabling a member ends their access on the next request', async () => {
      const bob = await addMember(t, acme, 'bob@acme.test');
      expect((await t.request('GET', '/api/v1/auth/me', { token: bob.token })).status).toBe(200);
      await t.request('PATCH', `/api/v1/core/members/${bob.userId}`, { token: acme.ownerToken, body: { status: 'disabled' } });
      const r = await t.request('GET', '/api/v1/auth/me', { token: bob.token });
      expect(r.status).toBe(401);
      expect(r.body.code).toBe('SESSION_REVOKED');
    });

    it('suspending a tenant ends its sessions on the next request', async () => {
      const initech = await provisionTenant(t, pt, 'suspendme');
      expect((await t.request('GET', '/api/v1/auth/me', { token: initech.ownerToken })).status).toBe(200);
      await t.owner.query(`update core.tenants set status = 'suspended' where id = $1`, [initech.id]);
      const r = await t.request('GET', '/api/v1/auth/me', { token: initech.ownerToken });
      expect(r.status).toBe(401);
      expect(r.body.code).toBe('SESSION_REVOKED');
    });

    it('a route that declares no access rule is closed, not open', async () => {
      const r = await t.request('GET', '/api/v1/test/undeclared', { token: acme.ownerToken });
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('ROUTE_ACCESS_UNDECLARED');
    });
  });

  describe('isolation between tenants through the API', () => {
    it('each owner sees only their own members and roles', async () => {
      const acmeMembers = await t.request('GET', '/api/v1/core/members', { token: acme.ownerToken });
      const globexMembers = await t.request('GET', '/api/v1/core/members', { token: globex.ownerToken });
      expect(acmeMembers.body.map((m: { email: string }) => m.email)).not.toContain(globex.ownerEmail);
      expect(globexMembers.body.map((m: { email: string }) => m.email)).toEqual([globex.ownerEmail]);
    });

    it('another tenant’s role id is simply not found', async () => {
      const acmeViewer = await roleByKey(acme, 'viewer');
      const r = await t.request('POST', `/api/v1/core/members/${globex.ownerId}/roles`, {
        token: globex.ownerToken,
        body: { roleId: acmeViewer.id },
      });
      expect(r.status).toBe(404);
      const del = await t.request('DELETE', `/api/v1/core/roles/${acmeViewer.id}`, { token: globex.ownerToken });
      expect(del.status).toBe(404);
    });

    it('a token for one tenant does not open another', async () => {
      // globex's owner is not a member of acme: logging into acme fails
      const r = await t.request('POST', '/api/v1/auth/login', { body: { email: globex.ownerEmail, password: 'owner-pass-123', tenant: 'acme' } });
      expect(r.status).toBe(401);
    });
  });
});
