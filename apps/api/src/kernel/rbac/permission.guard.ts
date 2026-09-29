import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { users } from '@simorgh/db';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { DbService } from '../db/db.module.js';
import { ApiError } from '../http/api-error.js';
import { IS_PUBLIC } from '../http/context.js';
import { holds, RbacService } from './rbac.service.js';

const REQUIRE_PERMISSION = 'simorgh:permission';
const PLATFORM_ADMIN = 'simorgh:platform-admin';
const AUTHENTICATED = 'simorgh:authenticated';

/** The route needs this permission in the caller's tenant. */
export const RequirePermission = (key: string) => SetMetadata(REQUIRE_PERMISSION, key);
/** The route is for Simorgh platform administrators in a platform session. */
export const PlatformAdminOnly = () => SetMetadata(PLATFORM_ADMIN, true);
/** The route is open to any signed-in user, in a tenant or platform session. */
export const Authenticated = () => SetMetadata(AUTHENTICATED, true);

/**
 * Second global guard, after AuthGuard. Deny by default: a route that declares
 * none of Public / Authenticated / PlatformAdminOnly / RequirePermission is
 * refused, so forgetting a decorator closes a route instead of opening it.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rbac: RbacService,
    private readonly db: DbService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const required = this.reflector.getAllAndOverride<string>(REQUIRE_PERMISSION, targets);
    const platformOnly = this.reflector.getAllAndOverride<boolean>(PLATFORM_ADMIN, targets);
    const anyUser = this.reflector.getAllAndOverride<boolean>(AUTHENTICATED, targets);
    if (!required && !platformOnly && !anyUser) {
      throw ApiError.forbidden('ROUTE_ACCESS_UNDECLARED', 'This route does not declare who may call it');
    }

    const ctx = context.switchToHttp().getRequest<FastifyRequest>().ctx;
    if (!ctx) throw ApiError.unauthorized();

    if (ctx.tenantId) {
      const principal = await this.rbac.principal(ctx.tenantId, ctx.userId);
      if (!principal) throw ApiError.unauthorized('SESSION_REVOKED', 'Membership or company is no longer active');
      ctx.grants = principal.grants;
    } else {
      const [u] = await this.db.platform(ctx.userId, (tx) =>
        tx.select({ active: users.isActive, admin: users.isPlatformAdmin }).from(users).where(eq(users.id, ctx.userId)),
      );
      if (!u?.active) throw ApiError.unauthorized('SESSION_REVOKED', 'User is no longer active');
      ctx.isPlatformAdmin = u.admin;
    }

    if (platformOnly && (ctx.tenantId || !ctx.isPlatformAdmin)) {
      throw ApiError.forbidden('PLATFORM_ADMIN_REQUIRED', 'Platform administrator session required');
    }
    if (required) {
      if (!ctx.tenantId) throw ApiError.forbidden('TENANT_REQUIRED', 'This endpoint needs a tenant session');
      if (!holds(ctx.grants, required)) {
        throw ApiError.forbidden('MISSING_PERMISSION', `Missing permission ${required}`);
      }
    }
    return true;
  }
}
