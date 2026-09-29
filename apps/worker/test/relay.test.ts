import { EVENTS_EXCHANGE, type EventEnvelope } from '@simorgh/contracts';
import { createTestDb, type TestDb } from '@simorgh/db/testing';
import amqp from 'amqplib';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AmqpPublisher } from '../src/amqp-publisher.js';
import { OutboxRelay, type Publisher } from '../src/relay.js';

// Real PostgreSQL (as simorgh_worker) and real RabbitMQ.
const AMQP_URL = process.env.AMQP_URL ?? 'amqp://guest:guest@localhost:5672';
const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';

describe('outbox relay', () => {
  let db: TestDb;
  let owner: pg.Pool;
  let worker: pg.Pool;

  const addEvent = (tenant: string, type: string, data: unknown) =>
    owner.query(
      `insert into core.outbox_events (tenant_id, type, subject_type, subject_id, payload, correlation_id)
       values ($1, $2, 'core.role', core.uuid_v7(), $3, core.uuid_v7())`,
      [tenant, type, { actor: { user_id: null, via: 'web' }, subject_no: 'R-1', data }],
    );
  const unpublished = async () =>
    (await owner.query<{ n: number }>('select count(*)::int n from core.outbox_events where published_at is null')).rows[0]!.n;

  beforeAll(async () => {
    db = await createTestDb();
    owner = new pg.Pool({ connectionString: db.ownerUrl, max: 2 });
    worker = new pg.Pool({ connectionString: db.workerUrl, max: 2 });
    await owner.query(`insert into core.tenants (id, code, name) values ($1,'ta','A'), ($2,'tb','B')`, [A, B]);
  });
  afterAll(async () => {
    await owner.end();
    await worker.end();
    await db.drop();
  });

  it('publishes every tenant’s events to RabbitMQ in order and marks them published', async () => {
    const conn = await amqp.connect(AMQP_URL);
    const ch = await conn.createChannel();
    await ch.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });
    const { queue } = await ch.assertQueue('', { exclusive: true });
    await ch.bindQueue(queue, EVENTS_EXCHANGE, 'core.#');

    await addEvent(A, 'core.role.changed', { n: 1 });
    await addEvent(B, 'core.member.added', { n: 2 });
    await addEvent(A, 'core.role.assigned', { n: 3 });

    const publisher = await AmqpPublisher.connect(AMQP_URL);
    const relay = new OutboxRelay(worker, publisher);
    expect(await relay.drain()).toBe(3);
    expect(await unpublished()).toBe(0);
    expect(await relay.drain()).toBe(0); // nothing twice

    const got: { key: string; env: EventEnvelope; messageId: string }[] = [];
    for (let i = 0; i < 50 && got.length < 3; i++) {
      const m = await ch.get(queue, { noAck: true });
      if (m) got.push({ key: m.fields.routingKey, env: JSON.parse(m.content.toString()), messageId: m.properties.messageId });
      else await new Promise((r) => setTimeout(r, 50));
    }
    expect(got.map((g) => g.key)).toEqual(['core.role.changed', 'core.member.added', 'core.role.assigned']);
    expect(got.map((g) => (g.env.data as { n: number }).n)).toEqual([1, 2, 3]);
    expect(got[1]!.env).toMatchObject({ tenant_id: B, version: 1, subject: { type: 'core.role', no: 'R-1' }, actor: { via: 'web' } });
    expect(got[0]!.messageId).toBe(got[0]!.env.id);

    await publisher.close();
    await ch.close();
    await conn.close();
  });

  it('keeps events and counts the attempt when the broker is unavailable', async () => {
    await addEvent(A, 'core.role.changed', { n: 4 });
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
    await addEvent(A, 'core.role.changed', { n: 5 });
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
