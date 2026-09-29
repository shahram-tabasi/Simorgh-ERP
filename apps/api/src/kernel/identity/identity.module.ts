import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { TokensService } from './tokens.service.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, PasswordService, TokensService],
  exports: [AuthService, AuthGuard, PasswordService, TokensService],
})
export class IdentityModule {}
