import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { LoginRequest, RefreshRequest } from '@simorgh/contracts';
import type { FastifyRequest } from 'fastify';
import { Ctx, Public, type RequestContext } from '../http/context.js';
import { Authenticated } from '../rbac/permission.guard.js';
import { AuthService, type ClientMeta } from './auth.service.js';

function meta(req: FastifyRequest): ClientMeta {
  const ua = req.headers['user-agent'];
  return { ip: req.ip ?? null, userAgent: typeof ua === 'string' ? ua : null, correlationId: randomUUID() };
}

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @Public()
  @HttpCode(200)
  login(@Body({ schema: LoginRequest }) body: LoginRequest, @Req() req: FastifyRequest) {
    return this.auth.login(body, meta(req));
  }

  @Post('refresh')
  @Public()
  @HttpCode(200)
  refresh(@Body({ schema: RefreshRequest }) body: RefreshRequest, @Req() req: FastifyRequest) {
    return this.auth.refresh(body.refreshToken, meta(req));
  }

  @Post('logout')
  @Authenticated()
  @HttpCode(204)
  logout(@Ctx() ctx: RequestContext) {
    return this.auth.logout(ctx);
  }

  @Get('me')
  @Authenticated()
  me(@Ctx() ctx: RequestContext) {
    return this.auth.me(ctx);
  }
}
