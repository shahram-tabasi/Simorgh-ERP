import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  createTestApp,
  login,
  PLATFORM_ADMIN,
  platformToken,
  provisionTenant,
  seedPlatformAdmin,
  type TenantFixture,
  type TestApp,
} from './harness.js';

describe('identity: login, sessions, refresh rotation', () => {
  let t: TestApp;
  let acme: TenantFixture;

  beforeAll(async () => {
    t = await createTestApp({ env: { LOGIN_MAX_FAILURES: '3' } });
    await seedPlatformAdmin(t);
    acme = await provisionTenant(t, await platformToken(t), 'acme');
  });
  afterAll(() => t.close());

  it('rejects anonymous calls with a problem document', async () => {
    const r = await t.request('GET', '/api/v1/auth/me');
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
  });

  it('stores passwords as argon2id', async () => {
    const r = await t.owner.query('select password_hash from core.users where email = $1', [acme.ownerEmail]);
    expect(r.rows[0].password_hash).toMatch(/^\$argon2id\$/);
  });

  it('logs a tenant member in and reports their permissions', async () => {
    const me = await t.request('GET', '/api/v1/auth/me', { token: acme.ownerToken });
    expect(me.status).toBe(200);
    expect(me.body.tenant).toMatchObject({ code: 'acme' });
    expect(me.body.permissions).toContain('core.role.manage');
  });

  it('matches email case-insensitively', async () => {
    await expect(login(t, acme.ownerEmail.toUpperCase(), 'owner-pass-123', 'acme')).resolves.toBeDefined();
  });

  it('gives the same answer for unknown user, wrong password and wrong company', async () => {
    const cases = [
      { email: 'nobody@acme.test', password: 'owner-pass-123', tenant: 'acme' },
      { email: acme.ownerEmail, password: 'wrong-password', tenant: 'acme' },
      { email: acme.ownerEmail, password: 'owner-pass-123', tenant: 'no-such-co' },
    ];
    for (const body of cases) {
      const r = await t.request('POST', '/api/v1/auth/login', { body });
      expect(r.status).toBe(401);
      expect(r.body.code).toBe('INVALID_CREDENTIALS');
    }
    // one failure was a bad password for a real account; reset for the next tests
    await t.owner.query('update core.users set failed_login_attempts = 0 where email = $1', [acme.ownerEmail]);
  });

  it('does not let a tenant member log in as platform administrator', async () => {
    const r = await t.request('POST', '/api/v1/auth/login', { body: { email: acme.ownerEmail, password: 'owner-pass-123' } });
    expect(r.status).toBe(401);
  });

  it('locks the account after repeated failures, even for the right password', async () => {
    const m = await addMember(t, acme, 'lockme@acme.test');
    expect(m.token).toBeTruthy();
    for (let i = 0; i < 3; i++) {
      await t.request('POST', '/api/v1/auth/login', { body: { email: 'lockme@acme.test', password: 'nope-nope-nope', tenant: 'acme' } });
    }
    const r = await t.request('POST', '/api/v1/auth/login', {
      body: { email: 'lockme@acme.test', password: 'member-pass-123', tenant: 'acme' },
    });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('ACCOUNT_LOCKED');
    const attempts = await t.owner.query(`select count(*)::int n from core.login_attempts where identifier = 'lockme@acme.test' and not success`);
    expect(attempts.rows[0].n).toBe(4); // the failures survived their own error responses
  });

  it('rotates refresh tokens and revokes the whole session when an old one is replayed', async () => {
    const first = await login(t, acme.ownerEmail, 'owner-pass-123', 'acme');
    const r1 = await t.request('POST', '/api/v1/auth/refresh', { body: { refreshToken: first.refreshToken } });
    expect(r1.status).toBe(200);
    expect(r1.body.refreshToken).not.toBe(first.refreshToken);

    const replay = await t.request('POST', '/api/v1/auth/refresh', { body: { refreshToken: first.refreshToken } });
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('REFRESH_TOKEN_REUSED');

    // the legitimate successor dies with the family, and so does its access token
    const r2 = await t.request('POST', '/api/v1/auth/refresh', { body: { refreshToken: r1.body.refreshToken } });
    expect(r2.status).toBe(401);
    const me = await t.request('GET', '/api/v1/auth/me', { token: r1.body.accessToken });
    expect(me.status).toBe(401);
    expect(me.body.code).toBe('SESSION_REVOKED');
  });

  it('ends the session immediately on logout', async () => {
    const s = await login(t, acme.ownerEmail, 'owner-pass-123', 'acme');
    expect((await t.request('POST', '/api/v1/auth/logout', { token: s.accessToken })).status).toBe(204);
    expect((await t.request('GET', '/api/v1/auth/me', { token: s.accessToken })).status).toBe(401);
    expect((await t.request('POST', '/api/v1/auth/refresh', { body: { refreshToken: s.refreshToken } })).status).toBe(401);
  });

  it('rejects a forged or malformed token', async () => {
    const s = await login(t, acme.ownerEmail, 'owner-pass-123', 'acme');
    const [h, p] = s.accessToken.split('.');
    const forged = `${h}.${p}.${'A'.repeat(43)}`;
    expect((await t.request('GET', '/api/v1/auth/me', { token: forged })).status).toBe(401);
    expect((await t.request('POST', '/api/v1/auth/refresh', { body: { refreshToken: 'x'.repeat(40) } })).status).toBe(401);
  });

  it('platform administrators get a platform session without tenant', async () => {
    const s = await login(t, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
    const me = await t.request('GET', '/api/v1/auth/me', { token: s.accessToken });
    expect(me.body).toMatchObject({ tenant: null, user: { isPlatformAdmin: true }, permissions: [] });
  });

  it('records logins in the audit trail of the tenant', async () => {
    const r = await t.owner.query(
      `select count(*)::int n from core.audit_log where tenant_id = $1 and action = 'core.session.login'`,
      [acme.id],
    );
    expect(r.rows[0].n).toBeGreaterThan(0);
  });
});
