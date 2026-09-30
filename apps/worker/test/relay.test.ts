import { randomUUID } from 'node:crypto';
import { Admin, Consumer, stringDeserializers } from '@platformatic/kafka';
import { EventHeaders, type EventEnvelope } from '@simorgh/contracts';
import { createTestDb, type TestDb } from '@simorgh/db/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KafkaPublisher } from '../src/kafka-publisher.js';
import { OutboxRelay, type Publisher } from '../src/relay.js';

// Real PostgreSQL (as simorgh_worker) and a real Kafka broker.
const BROKERS = (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',');
const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';

interface Received {
  topic: string;
  partition: number;
  key: string;
  headers: Record<string, string>;
  env: EventEnvelope;
}

/** Reads a topic from the beginning until `count` messages arrived. */
async function readTopic(topic: string, count: number): Promise<Received[]> {
  const consumer = new Consumer({
    groupId: `test-${randomUUID()}`,
    clientId: 'relay-test',
    bootstrapBrokers: BROKERS,
    deserializers: stringDeserializers,
  });
  const stream = await consumer.consume({ topics: [topic], mode: 'earliest', autocommit: false });
  const got: Received[] = [];
  const timeout = setTimeout(() => void stream.close(), 15_000);
  for await (const m of stream) {
    got.push({
      topic: m.topic,
      partition: m.partition,
      key: m.key,
      headers: Object.fromEntries(m.headers),
      env: JSON.parse(m.value) as EventEnvelope,
    });
    if (got.length >= count) break;
  }
  clearTimeout(timeout);
  await stream.close();
  await consumer.close(true);
  return got;
}

describe('outbox relay → Kafka', () => {
  let db: TestDb;
  let owner: pg.Pool;
  let worker: pg.Pool;
  // a fresh module name per run keeps topics from earlier runs out of the assertions
  const mod = `test${randomUUID().replace(/[^a-f]/g, '').slice(0, 8)}`;
  const topic = `erp.${mod}.events`;

  const addEvent = async (tenant: string, verb: string, data: unknown, subjectId?: string) => {
    const r = await owner.query<{ subject_id: string }>(
      `insert into core.outbox_events (tenant_id, type, subject_type, subject_id, payload, correlation_id)
       values ($1, $2, 'core.role', coalesce($4::uuid, core.uuid_v7()), $3, core.uuid_v7())
       returning subject_id`,
      [tenant, `${mod}.role.${verb}`, { actor: { user_id: null, via: 'web' }, subject_no: 'R-1', data }, subjectId ?? null],
    );
    return r.rows[0]!.subject_id;
  };
  const unpublished = async () =>
    (await owner.query<{ n: number }>('select count(*)::int n from core.outbox_events where published_at is null')).rows[0]!.n;

  beforeAll(async () => {
    db = await createTestDb();
    owner = new pg.Pool({ connectionString: db.ownerUrl, max: 2 });
    worker = new pg.Pool({ connectionString: db.workerUrl, max: 2 });
    await owner.query(`insert into core.tenants (id, code, name) values ($1,'ta','A'), ($2,'tb','B')`, [A, B]);
  });
  afterAll(async () => {
    const admin = new Admin({ clientId: 'relay-test-cleanup', bootstrapBrokers: BROKERS });
    await admin.deleteTopics({ topics: [topic] }).catch(() => undefined);
    await admin.close();
    await owner.end();
    await worker.end();
    await db.drop();
  });

  it('publishes every tenant’s events with key and headers, and keeps one subject in order', async () => {
    const subject = await addEvent(A, 'changed', { n: 1 });
    await addEvent(B, 'added', { n: 2 });
    await addEvent(A, 'assigned', { n: 3 }, subject);
    await addEvent(A, 'changed', { n: 4 }, subject);

    const publisher = new KafkaPublisher({ brokers: BROKERS, partitions: 3 });
    const relay = new OutboxRelay(worker, publisher);
    expect(await relay.drain()).toBe(4);
    expect(await unpublished()).toBe(0);
    expect(await relay.drain()).toBe(0); // nothing twice
    await publisher.close();

    const got = await readTopic(topic, 4);
    expect(got).toHaveLength(4);
    expect(new Set(got.map((g) => g.topic))).toEqual(new Set([topic]));

    // everything about one subject: same key, same partition, original order
    const same = got.filter((g) => g.key === subject);
    expect(same.map((g) => (g.env.data as { n: number }).n)).toEqual([1, 3, 4]);
    expect(new Set(same.map((g) => g.partition)).size).toBe(1);

    const b = got.find((g) => g.env.tenant_id === B)!;
    expect(b.env).toMatchObject({ type: `${mod}.role.added`, version: 1, subject: { type: 'core.role', no: 'R-1' }, actor: { via: 'web' } });
    expect(b.headers).toMatchObject({
      [EventHeaders.id]: b.env.id,
      [EventHeaders.type]: `${mod}.role.added`,
      [EventHeaders.tenant]: B,
      [EventHeaders.version]: '1',
    });
    expect(b.headers[EventHeaders.correlation]).toBe(b.env.correlation_id);
  });

  it('creates event topics with the configured partitions and retention', async () => {
    const admin = new Admin({ clientId: 'relay-test-admin', bootstrapBrokers: BROKERS });
    const meta = await admin.metadata({ topics: [topic] });
    expect(meta.topics.get(topic)?.partitionsCount).toBe(3);
    const [described] = await admin.describeConfigs({
      resources: [{ resourceType: 2, resourceName: topic, configurationKeys: ['retention.ms'] }],
    });
    expect(described?.configs.find((c) => c.name === 'retention.ms')?.value).toBe(String(365 * 86_400_000));
    await admin.close();
  });

  it('keeps events and counts the attempt when the broker is unavailable', async () => {
    await addEvent(A, 'changed', { n: 5 });
    const broken: Publisher = {
      publish: async () => {
        throw new Error('broker down');
      },
    };
    await expect(new OutboxRelay(worker, broken).runOnce()).rejects.toThrow('broker down');
    expect(await unpublished()).toBe(1);
    const r = await owner.query(`select attempts from core.outbox_events where published_at is null`);
    expect(r.rows[0].attempts).toBe(1);
  });

  it('two relays never claim the same rows at once', async () => {
    await addEvent(A, 'changed', { n: 6 });
    const seen: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: Publisher = {
      publish: async (events) => {
        seen.push(...events.map((e) => e.id));
        await gate;
      },
    };
    const fast: Publisher = { publish: async (events) => void seen.push(...events.map((e) => e.id)) };
    const first = new OutboxRelay(worker, slow).runOnce();
    await new Promise((r) => setTimeout(r, 100));
    expect(await new OutboxRelay(worker, fast).runOnce()).toBe(0); // rows are locked by the first
    release();
    expect(await first).toBe(2);
    expect(new Set(seen).size).toBe(seen.length);
  });
});
