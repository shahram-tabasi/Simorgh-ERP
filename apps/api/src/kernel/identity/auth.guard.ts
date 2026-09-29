import { randomUUID } from 'node:crypto';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { ApiError } from '../http/api-error.js';
import { IS_PUBLIC } from '../http/context.js';
import { AuthService } from './auth.service.js';
import { TokensService } from './tokens.service.js';

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

/**
 * First global guard: turns a Bearer access token into `request.ctx`.
 * Authorisation (membership, permissions) is PermissionGuard's job.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const header = req.headers['x-request-id'];
    const correlationId = typeof header === 'string' && REQUEST_ID.test(header) ? header : randomUUID();

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) {
      return true;
    }

    const authz = req.headers.authorization;
    const token = authz?.startsWith('Bearer ') ? authz.slice(7) : null;
    const claims = token ? await this.tokens.verifyAccess(token) : null;
    if (!claims) throw ApiError.unauthorized();
    // logout and refresh-token reuse must end the session now, not in 15 minutes
    if (!(await this.auth.sessionIsLive(claims.sid))) {
      throw ApiError.unauthorized('SESSION_REVOKED', 'Session has ended');
    }

    req.ctx = {
      userId: claims.sub,
      tenantId: claims.tid ?? null,
      sessionId: claims.sid,
      isPlatformAdmin: false, // confirmed from the database by PermissionGuard
      via: 'web',
      ip: req.ip ?? null,
      correlationId,
    };
    return true;
  }
}
