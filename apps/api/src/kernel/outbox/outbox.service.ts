import { Injectable } from '@nestjs/common';
import { outboxEvents, type Tx } from '@simorgh/db';
import { sql } from 'drizzle-orm';
import type { RequestContext } from '../http/context.js';

export interface DomainEvent<T = unknown> {
  type: string;
  version?: number;
  subject: { type: string; id: string; no?: string | null };
  legalEntityId?: string | null;
  data: T;
}

/**
 * Transactional outbox (architecture §20): the event row is written in the
 * same transaction as the change it describes. The worker's relay publishes
 * it to RabbitMQ afterwards, so an event exists if and only if its change
 * committed.
 */
@Injectable()
export class OutboxService {
  async enqueue<T>(tx: Tx, ctx: Partial<RequestContext> | null, event: DomainEvent<T>): Promise<string> {
    const [row] = await tx
      .insert(outboxEvents)
      .values({
        tenantId: sql`core.current_tenant()`,
        type: event.type,
        version: event.version ?? 1,
        subjectType: event.subject.type,
        subjectId: event.subject.id,
        correlationId: ctx?.correlationId ?? null,
        payload: {
          actor: { user_id: ctx?.userId ?? null, via: ctx?.via ?? 'system' },
          legal_entity_id: event.legalEntityId ?? null,
          subject_no: event.subject.no ?? null,
          data: event.data,
        },
      })
      .returning({ id: outboxEvents.id });
    return row!.id;
  }
}
