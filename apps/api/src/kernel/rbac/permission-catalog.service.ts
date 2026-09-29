import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ALL_PERMISSION_DEFS, type PermissionDef } from '@simorgh/contracts';
import { permissions } from '@simorgh/db';
import { sql } from 'drizzle-orm';
import { DbService } from '../db/db.module.js';

/**
 * Permissions are declared in code (packages/contracts) and mirrored into
 * core.permissions at boot, so role grants can reference them by foreign key.
 * Keys are never deleted here: a key that disappears from code keeps its row
 * (and its grants) until a migration retires it deliberately.
 */
@Injectable()
export class PermissionCatalogService implements OnApplicationBootstrap {
  private readonly log = new Logger(PermissionCatalogService.name);
  private readonly byKey = new Map<string, PermissionDef>(ALL_PERMISSION_DEFS.map((d) => [d.key, d]));

  constructor(private readonly db: DbService) {}

  get(key: string): PermissionDef | undefined {
    return this.byKey.get(key);
  }

  all(): PermissionDef[] {
    return [...this.byKey.values()];
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.sync();
  }

  async sync(): Promise<void> {
    const defs = this.all();
    await this.db.platform(null, (tx) =>
      tx
        .insert(permissions)
        .values(defs.map((d) => ({ key: d.key, module: d.module, labelFa: d.labelFa, labelEn: d.labelEn, scopes: d.scopes })))
        .onConflictDoUpdate({
          target: permissions.key,
          set: {
            module: sql`excluded.module`,
            labelFa: sql`excluded.label_fa`,
            labelEn: sql`excluded.label_en`,
            scopes: sql`excluded.scopes`,
          },
        }),
    );
    this.log.log(`permission catalog synced (${defs.length} keys)`);
  }
}
