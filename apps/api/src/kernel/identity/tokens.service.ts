import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import { CONFIG, type Config } from '../../config.js';

export interface AccessClaims {
  sub: string;
  /** Tenant id; absent in a platform session. */
  tid?: string;
  /** Session (refresh-token family) id. */
  sid: string;
}

const AUDIENCE = 'simorgh-api';

@Injectable()
export class TokensService {
  private readonly key: Uint8Array;

  constructor(@Inject(CONFIG) private readonly config: Config) {
    this.key = new TextEncoder().encode(config.JWT_SECRET);
  }

  get accessTtl(): number {
    return this.config.ACCESS_TOKEN_TTL_SEC;
  }

  signAccess(claims: AccessClaims): Promise<string> {
    const jwt = new SignJWT({ sid: claims.sid, ...(claims.tid ? { tid: claims.tid } : {}) })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuer(this.config.JWT_ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.config.ACCESS_TOKEN_TTL_SEC}s`);
    return jwt.sign(this.key);
  }

  async verifyAccess(token: string): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: this.config.JWT_ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
      return { sub: payload.sub, sid: payload.sid, ...(typeof payload.tid === 'string' ? { tid: payload.tid } : {}) };
    } catch {
      return null;
    }
  }

  /** A refresh token is `<row id>.<secret>`; only sha256(secret) is stored. */
  newRefreshSecret(): { secret: string; hash: string } {
    const secret = randomBytes(32).toString('base64url');
    return { secret, hash: sha256(secret) };
  }

  parseRefresh(token: string): { id: string; secret: string } | null {
    const m = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(token);
    return m ? { id: m[1]!, secret: m[2]! } : null;
  }

  matches(secret: string, storedHash: string): boolean {
    const a = Buffer.from(sha256(secret), 'hex');
    const b = Buffer.from(storedHash, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  refreshExpiry(): Date {
    return new Date(Date.now() + this.config.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  }
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
