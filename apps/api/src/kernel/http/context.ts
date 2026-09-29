import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Grant } from '../rbac/rbac.service.js';
import { ApiError } from './api-error.js';

/** Who is calling, on whose behalf, inside which tenant. Built by AuthGuard. */
export interface RequestContext {
  userId: string;
  tenantId: string | null;
  sessionId: string;
  isPlatformAdmin: boolean;
  via: 'web' | 'api' | 'agent';
  ip: string | null;
  correlationId: string;
  /** Filled by PermissionGuard for tenant requests. */
  grants?: Grant[];
}

/** A context that is known to be inside a tenant. */
export type TenantContext = RequestContext & { tenantId: string };

declare module 'fastify' {
  interface FastifyRequest {
    ctx?: RequestContext;
  }
}

export const Ctx = createParamDecorator((_: unknown, host: ExecutionContext): RequestContext => {
  const ctx = host.switchToHttp().getRequest<FastifyRequest>().ctx;
  if (!ctx) throw ApiError.unauthorized();
  return ctx;
});

/** Like Ctx, but rejects a platform session: the route only makes sense inside a tenant. */
export const TenantCtx = createParamDecorator((_: unknown, host: ExecutionContext): TenantContext => {
  const ctx = host.switchToHttp().getRequest<FastifyRequest>().ctx;
  if (!ctx) throw ApiError.unauthorized();
  if (!ctx.tenantId) throw ApiError.forbidden('TENANT_REQUIRED', 'This endpoint needs a tenant session');
  return ctx as TenantContext;
});

export const IS_PUBLIC = 'simorgh:public';
/** The route needs no authentication. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
