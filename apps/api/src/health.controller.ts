import { Controller, Get } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbService } from './kernel/db/db.module.js';
import { Public } from './kernel/http/context.js';

@Controller()
export class HealthController {
  constructor(private readonly db: DbService) {}

  @Get('health')
  @Public()
  async health() {
    await this.db.db.execute(sql`select 1`);
    return { status: 'ok' };
  }
}
