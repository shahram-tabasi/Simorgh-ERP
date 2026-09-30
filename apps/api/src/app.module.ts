import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { StandardSchemaValidationPipe } from '@nestjs/common';
import { CONFIG, type Config } from './config.js';
import { HealthController } from './health.controller.js';
import { DbModule } from './kernel/db/db.module.js';
import { FilesModule } from './kernel/files/files.module.js';
import { ProblemFilter } from './kernel/http/problem.filter.js';
import { AuthGuard } from './kernel/identity/auth.guard.js';
import { IdentityModule } from './kernel/identity/identity.module.js';
import { PermissionGuard } from './kernel/rbac/permission.guard.js';
import { RbacModule } from './kernel/rbac/rbac.module.js';
import { KernelSharedModule } from './kernel/shared.module.js';
import { KernelWorkModule } from './kernel/work.module.js';
import { HcmModule } from './modules/hcm/hcm.module.js';
import { TenancyModule } from './kernel/tenancy/tenancy.module.js';

@Module({})
export class AppModule {
  static forRoot(config: Config): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [DbModule, KernelSharedModule, IdentityModule, RbacModule, KernelWorkModule, TenancyModule, FilesModule, HcmModule],
      controllers: [HealthController],
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: APP_PIPE, useValue: new StandardSchemaValidationPipe() },
        { provide: APP_FILTER, useClass: ProblemFilter },
        // order matters: authenticate, then authorise
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: PermissionGuard },
      ],
      exports: [CONFIG],
    };
  }
}
