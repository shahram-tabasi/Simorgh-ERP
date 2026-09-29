import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { LoginRequest, MeResponse, TokenPair } from '@simorgh/contracts';
import { loginAttempts, refreshTokens, tenantMemberships, tenants, users, type Tx } from '@simorgh/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { CONFIG, type Config } from '../../config.js';
import { AuditService } from '../audit/audit.service.js';
import { DbService } from '../db/db.module.js';
import { ApiError } from '../http/api-error.js';
import type { RequestContext } from '../http/context.js';
import { PasswordService } from './password.service.js';
import { TokensService } from './tokens.service.js';

export interface ClientMeta {
  ip: string | null;
  userAgent: string | null;
  correlationId: string;
}

type Tenant = typeof tenants.$inferSelect;

const invalid = () => ApiError.unauthorized('INVALID_CREDENTIALS', 'Email, password or company is not correct');

@Injectable()
export class AuthService {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly db: DbService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokensService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Tenant login (`tenant` given) or platform-administrator login (no tenant).
   *
   * Failures are recorded in their own transaction *before* the error is
   * thrown: inside the main transaction the rollback would erase the very
   * record that the lockout counts.
   */
  async login(body: LoginRequest, meta: ClientMeta): Promise<TokenPair> {
    const email = body.email.trim();
    const [user] = await this.db.platform(null, (tx) => tx.select().from(users).where(eq(users.email, email)));

    if (!user || !user.isActive || !user.passwordHash) {
      await this.passwords.verify(null, body.password);
      await this.recordFailure(email, meta, 'unknown_or_inactive', null);
      throw invalid();
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.recordFailure(email, meta, 'locked', null);
      throw ApiError.unauthorized('ACCOUNT_LOCKED', 'Too many failed attempts; try again later');
    }
    if (!(await this.passwords.verify(user.passwordHash, body.password))) {
      await this.recordFailure(email, meta, 'bad_password', user.id);
      throw invalid();
    }

    let tenant: Tenant | null = null;
    if (body.tenant) {
      tenant = await this.activeTenantByCode(body.tenant);
      const member = tenant && (await this.activeMembership(tenant.id, user.id));
      if (!tenant || !member) {
        await this.recordFailure(email, meta, 'no_membership', null);
        throw invalid();
      }
    } else if (!user.isPlatformAdmin) {
      await this.recordFailure(email, meta, 'not_platform_admin', null);
      throw invalid();
    }

    const familyId = randomUUID();
    const refresh = await this.db.platform(user.id, async (tx) => {
      await tx
        .update(users)
        .set({ failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() })
        .where(eq(users.id, user.id));
      await tx.insert(loginAttempts).values({ identifier: email, ipAddress: meta.ip, success: true, reason: tenant?.code ?? 'platform' });
      return this.issueRefresh(tx, user.id, tenant?.id ?? null, familyId, meta);
    });

    const ctx: Partial<RequestContext> = { userId: user.id, via: 'web', ip: meta.ip, correlationId: meta.correlationId };
    const entry = { action: 'core.session.login', entityType: 'core.user', entityId: user.id, after: { session: familyId } };
    if (tenant) await this.db.tenant({ tenantId: tenant.id, userId: user.id }, (tx) => this.audit.record(tx, ctx, entry));
    else await this.db.platform(user.id, (tx) => this.audit.record(tx, ctx, entry));

    return this.pair(user.id, tenant?.id ?? null, familyId, refresh);
  }

  /**
   * Rotates a refresh token. Presenting a token that was already rotated means
   * it was copied: the whole session family is revoked (RFC 6819 §5.2.2.3).
   */
  async refresh(token: string, meta: ClientMeta): Promise<TokenPair> {
    const parsed = this.tokens.parseRefresh(token);
    if (!parsed) throw ApiError.unauthorized('INVALID_REFRESH_TOKEN', 'Invalid refresh token');

    const [row] = await this.db.platform(null, (tx) =>
      tx.select().from(refreshTokens).where(eq(refreshTokens.id, parsed.id)),
    );
    if (!row || !this.tokens.matches(parsed.secret, row.tokenHash)) {
      throw ApiError.unauthorized('INVALID_REFRESH_TOKEN', 'Invalid refresh token');
    }
    if (row.revokedAt) {
      await this.revokeFamily(row.familyId);
      throw ApiError.unauthorized('REFRESH_TOKEN_REUSED', 'Session revoked: refresh token was used twice');
    }
    if (row.expiresAt <= new Date()) throw ApiError.unauthorized('REFRESH_TOKEN_EXPIRED', 'Session expired');

    const [user] = await this.db.platform(null, (tx) => tx.select().from(users).where(eq(users.id, row.userId)));
    if (!user?.isActive) throw ApiError.unauthorized('SESSION_REVOKED', 'User is no longer active');
    if (row.sessionTenantId) {
      const [t] = await this.db.platform(null, (tx) => tx.select().from(tenants).where(eq(tenants.id, row.sessionTenantId!)));
      if (!t || !isOpen(t) || !(await this.activeMembership(t.id, user.id))) {
        await this.revokeFamily(row.familyId);
        throw ApiError.unauthorized('SESSION_REVOKED', 'Membership is no longer active');
      }
    } else if (!user.isPlatformAdmin) {
      throw ApiError.unauthorized('SESSION_REVOKED', 'Platform access was withdrawn');
    }

    const next = await this.db.platform(user.id, async (tx) => {
      // Conditional update: of two concurrent refreshes with the same token, only one wins.
      const won = await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.id, row.id), isNull(refreshTokens.revokedAt)))
        .returning({ id: refreshTokens.id });
      if (!won.length) return null;
      return this.issueRefresh(tx, user.id, row.sessionTenantId, row.familyId, meta);
    });
    if (!next) {
      await this.revokeFamily(row.familyId);
      throw ApiError.unauthorized('REFRESH_TOKEN_REUSED', 'Session revoked: refresh token was used twice');
    }
    return this.pair(user.id, row.sessionTenantId, row.familyId, next);
  }

  async logout(ctx: RequestContext): Promise<void> {
    await this.revokeFamily(ctx.sessionId);
    const entry = { action: 'core.session.logout', entityType: 'core.user', entityId: ctx.userId };
    if (ctx.tenantId) await this.db.tenant(ctx, (tx) => this.audit.record(tx, ctx, entry));
    else await this.db.platform(ctx.userId, (tx) => this.audit.record(tx, ctx, entry));
  }

  /** False once the session family is revoked (logout, reuse, disabled membership). */
  async sessionIsLive(familyId: string): Promise<boolean> {
    const res = await this.db.platform(null, (tx) =>
      tx.execute(sql`select 1 from core.refresh_tokens where family_id = ${familyId} and revoked_at is null and expires_at > now() limit 1`),
    );
    return res.rows.length > 0;
  }

  async me(ctx: RequestContext): Promise<MeResponse> {
    const [user] = await this.db.platform(ctx.userId, (tx) => tx.select().from(users).where(eq(users.id, ctx.userId)));
    if (!user) throw ApiError.unauthorized();
    let tenant: MeResponse['tenant'] = null;
    if (ctx.tenantId) {
      const [t] = await this.db.platform(ctx.userId, (tx) => tx.select().from(tenants).where(eq(tenants.id, ctx.tenantId!)));
      if (t) tenant = { id: t.id, code: t.code, name: t.name };
    }
    return {
      user: { id: user.id, email: user.email, displayName: user.displayName, isPlatformAdmin: user.isPlatformAdmin },
      tenant,
      permissions: [...new Set((ctx.grants ?? []).map((g) => g.key))].sort(),
    };
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async recordFailure(email: string, meta: ClientMeta, reason: string, userId: string | null): Promise<void> {
    await this.db.platform(null, async (tx) => {
      await tx.insert(loginAttempts).values({ identifier: email, ipAddress: meta.ip, success: false, reason });
      if (userId) {
        await tx
          .update(users)
          .set({
            failedLoginAttempts: sql`${users.failedLoginAttempts} + 1`,
            lockedUntil: sql`case when ${users.failedLoginAttempts} + 1 >= ${this.config.LOGIN_MAX_FAILURES}
                              then now() + make_interval(mins => ${this.config.LOGIN_LOCK_MINUTES}) else ${users.lockedUntil} end`,
          })
          .where(eq(users.id, userId));
      }
    });
  }

  private async activeTenantByCode(code: string): Promise<Tenant | null> {
    const [t] = await this.db.platform(null, (tx) => tx.select().from(tenants).where(eq(tenants.code, code)));
    return t && isOpen(t) ? t : null;
  }

  private async activeMembership(tenantId: string, userId: string): Promise<boolean> {
    const [m] = await this.db.tenant({ tenantId, userId }, (tx) =>
      tx.select({ status: tenantMemberships.status }).from(tenantMemberships).where(eq(tenantMemberships.userId, userId)),
    );
    return m?.status === 'active';
  }

  private async issueRefresh(tx: Tx, userId: string, tenantId: string | null, familyId: string, meta: ClientMeta): Promise<string> {
    const { secret, hash } = this.tokens.newRefreshSecret();
    const [row] = await tx
      .insert(refreshTokens)
      .values({
        userId,
        sessionTenantId: tenantId,
        familyId,
        tokenHash: hash,
        ipAddress: meta.ip,
        deviceInfo: meta.userAgent ? { userAgent: meta.userAgent.slice(0, 300) } : null,
        expiresAt: this.tokens.refreshExpiry(),
      })
      .returning({ id: refreshTokens.id });
    return `${row!.id}.${secret}`;
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.db.platform(null, (tx) =>
      tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt))),
    );
  }

  private async pair(userId: string, tenantId: string | null, familyId: string, refreshToken: string): Promise<TokenPair> {
    const accessToken = await this.tokens.signAccess({ sub: userId, sid: familyId, ...(tenantId ? { tid: tenantId } : {}) });
    return { accessToken, refreshToken, expiresIn: this.tokens.accessTtl };
  }
}

function isOpen(t: Tenant): boolean {
  return t.status === 'active' || t.status === 'trial';
}
