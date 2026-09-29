import pg from 'pg';
import { AmqpPublisher } from './amqp-publisher.js';
import { OutboxRelay } from './relay.js';

// The relay connects as simorgh_worker: BYPASSRLS, but granted only the outbox.
const dbUrl = process.env.WORKER_DATABASE_URL;
const amqpUrl = process.env.AMQP_URL ?? 'amqp://guest:guest@localhost:5672';
const pollMs = Number(process.env.OUTBOX_POLL_MS ?? 5000);
if (!dbUrl) {
  console.error('WORKER_DATABASE_URL is not set');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: dbUrl, max: 2 });
const publisher = await AmqpPublisher.connect(amqpUrl);
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

console.log('outbox relay started');
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
