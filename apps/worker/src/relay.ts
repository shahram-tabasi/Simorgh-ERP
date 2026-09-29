import type { EventEnvelope } from '@simorgh/contracts';
import type pg from 'pg';

export interface Publisher {
  /** Resolves once the broker has confirmed every envelope (publisher confirms). */
  publish(events: EventEnvelope[]): Promise<void>;
}

interface OutboxRow {
  id: string;
  tenant_id: string;
  type: string;
  version: number;
  subject_type: string;
  subject_id: string;
  payload: {
    actor?: EventEnvelope['actor'];
    legal_entity_id?: string | null;
    subject_no?: string | null;
    data?: unknown;
  };
  correlation_id: string | null;
  occurred_at: Date;
}

export function toEnvelope(row: OutboxRow): EventEnvelope {
  return {
    id: row.id,
    type: row.type,
    version: row.version,
    occurred_at: row.occurred_at.toISOString(),
    tenant_id: row.tenant_id,
    legal_entity_id: row.payload.legal_entity_id ?? null,
    actor: row.payload.actor ?? { user_id: null, via: 'system' },
    correlation_id: row.correlation_id,
    subject: { type: row.subject_type, id: row.subject_id, no: row.payload.subject_no ?? null },
    data: row.payload.data ?? null,
  };
}

/**
 * Moves committed outbox rows to the message bus (architecture §20).
 *
 * Delivery is at-least-once: rows are marked published only after the broker
 * confirms them, so a crash between the two republishes them — consumers
 * de-duplicate on the event id (core.inbox_events). Rows are claimed with
 * FOR UPDATE SKIP LOCKED so a second relay instance never double-sends
 * concurrently; one instance keeps global order, which is the intended setup.
 */
export class OutboxRelay {
  constructor(
    private readonly pool: pg.Pool,
    private readonly publisher: Publisher,
    private readonly batchSize = 100,
  ) {}

  /** Publishes one batch; returns how many rows were published. */
  async runOnce(): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<OutboxRow>(
        `select id, tenant_id, type, version, subject_type, subject_id, payload, correlation_id, occurred_at
           from core.outbox_events
          where published_at is null
          order by occurred_at, id
          limit $1
          for update skip locked`,
        [this.batchSize],
      );
      if (!rows.length) {
        await client.query('COMMIT');
        return 0;
      }
      const ids = rows.map((r) => r.id);
      try {
        await this.publisher.publish(rows.map(toEnvelope));
      } catch (err) {
        await client.query(`update core.outbox_events set attempts = attempts + 1 where id = any($1::uuid[])`, [ids]);
        await client.query('COMMIT');
        throw err;
      }
      await client.query(
        `update core.outbox_events set published_at = now(), attempts = attempts + 1 where id = any($1::uuid[])`,
        [ids],
      );
      await client.query('COMMIT');
      return rows.length;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /** Publishes until the outbox is empty. */
  async drain(): Promise<number> {
    let total = 0;
    for (let n = await this.runOnce(); n > 0; n = await this.runOnce()) total += n;
    return total;
  }
}
