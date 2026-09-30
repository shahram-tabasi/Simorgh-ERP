import { Admin, Producer, stringSerializers } from '@platformatic/kafka';
import { EventHeaders, eventTopic, type EventEnvelope } from '@simorgh/contracts';
import type { Publisher } from './relay.js';

export interface KafkaPublisherOptions {
  brokers: string[];
  clientId?: string;
  /** Partitions for a new event topic. Ordering is per subject, so more partitions only add parallelism. */
  partitions?: number;
  /** 1 for a single on-prem broker, 3 for a production cluster. */
  replicationFactor?: number;
  /** How long events stay replayable. -1 keeps them forever. */
  retentionMs?: number;
}

/**
 * Publishes outbox events to Kafka (architecture §20, ADR-07).
 *
 * - key = subject id: every event about one document lands in one partition, in order;
 * - idempotent producer with acks=all: a retried send is written once, and a
 *   send resolves only when every in-sync replica has it;
 * - topics are created here with explicit partitions and retention rather than
 *   left to broker auto-creation, whose defaults (1 partition, 7 days) would
 *   silently decide how long history can be replayed.
 */
export class KafkaPublisher implements Publisher {
  private readonly producer: Producer<string, string, string, string>;
  private readonly admin: Admin;
  private readonly knownTopics = new Set<string>();
  private readonly partitions: number;
  private readonly replicationFactor: number;
  private readonly retentionMs: number;

  constructor(opts: KafkaPublisherOptions) {
    const clientId = opts.clientId ?? 'simorgh-outbox-relay';
    this.partitions = opts.partitions ?? 6;
    this.replicationFactor = opts.replicationFactor ?? 1;
    this.retentionMs = opts.retentionMs ?? 365 * 86_400_000;
    this.producer = new Producer({
      clientId,
      bootstrapBrokers: opts.brokers,
      serializers: stringSerializers,
      idempotent: true,
      acks: -1,
      autocreateTopics: false,
    });
    this.admin = new Admin({ clientId: `${clientId}-admin`, bootstrapBrokers: opts.brokers });
  }

  async publish(events: EventEnvelope[]): Promise<void> {
    if (!events.length) return;
    await this.ensureTopics([...new Set(events.map((e) => eventTopic(e.type)))]);
    await this.producer.send({
      messages: events.map((e) => ({
        topic: eventTopic(e.type),
        key: e.subject.id,
        value: JSON.stringify(e),
        headers: {
          [EventHeaders.id]: e.id,
          [EventHeaders.type]: e.type,
          [EventHeaders.version]: String(e.version),
          [EventHeaders.tenant]: e.tenant_id,
          ...(e.correlation_id ? { [EventHeaders.correlation]: e.correlation_id } : {}),
        },
      })),
    });
  }

  /** Creates missing event topics with Simorgh's settings; tolerates a concurrent creator. */
  async ensureTopics(topics: string[]): Promise<void> {
    const missing = topics.filter((t) => !this.knownTopics.has(t));
    if (!missing.length) return;
    const existing = new Set(await this.admin.listTopics());
    const toCreate = missing.filter((t) => !existing.has(t));
    if (toCreate.length) {
      try {
        await this.admin.createTopics({
          topics: toCreate,
          partitions: this.partitions,
          replicas: this.replicationFactor,
          configs: [
            { name: 'retention.ms', value: String(this.retentionMs) },
            { name: 'cleanup.policy', value: 'delete' },
            { name: 'min.insync.replicas', value: String(Math.min(2, this.replicationFactor)) },
          ],
        });
      } catch (err) {
        // another relay instance may have created them between list and create
        const now = new Set(await this.admin.listTopics());
        if (!toCreate.every((t) => now.has(t))) throw err;
      }
    }
    for (const t of missing) this.knownTopics.add(t);
  }

  async close(): Promise<void> {
    await this.producer.close().catch(() => undefined);
    await this.admin.close().catch(() => undefined);
  }
}
