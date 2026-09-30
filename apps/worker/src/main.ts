import pg from 'pg';
import { KafkaPublisher } from './kafka-publisher.js';
import { OutboxRelay } from './relay.js';

// The relay connects as simorgh_worker: BYPASSRLS, but granted only the outbox.
const dbUrl = process.env.WORKER_DATABASE_URL;
const brokers = (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',').map((s) => s.trim());
const pollMs = Number(process.env.OUTBOX_POLL_MS ?? 5000);
if (!dbUrl) {
  console.error('WORKER_DATABASE_URL is not set');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: dbUrl, max: 2 });
const publisher = new KafkaPublisher({
  brokers,
  partitions: Number(process.env.KAFKA_EVENTS_PARTITIONS ?? 6),
  replicationFactor: Number(process.env.KAFKA_REPLICATION_FACTOR ?? 1),
  retentionMs: Number(process.env.KAFKA_EVENTS_RETENTION_MS ?? 365 * 86_400_000),
});
const relay = new OutboxRelay(pool, publisher);

// Woken by NOTIFY from the outbox trigger; the poll is only a safety net.
const listener = new pg.Client({ connectionString: dbUrl });
await listener.connect();
await listener.query('LISTEN outbox');

let wake: (() => void) | null = null;
listener.on('notification', () => wake?.());
let running = true;
const stop = async () => {
  running = false;
  wake?.();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

console.log(`outbox relay started (kafka: ${brokers.join(',')})`);
while (running) {
  try {
    const n = await relay.drain();
    if (n) console.log(`published ${n} event(s)`);
  } catch (err) {
    console.error('publish failed, will retry', err);
  }
  await new Promise<void>((resolve) => {
    wake = resolve;
    setTimeout(resolve, pollMs);
  });
  wake = null;
}
await listener.end();
await publisher.close();
await pool.end();
console.log('outbox relay stopped');
