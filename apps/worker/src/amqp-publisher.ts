import { EVENTS_EXCHANGE, type EventEnvelope } from '@simorgh/contracts';
import amqp from 'amqplib';
import type { Publisher } from './relay.js';

/** RabbitMQ publisher on a confirm channel: `publish` resolves only once the broker has the messages. */
export class AmqpPublisher implements Publisher {
  private constructor(
    private readonly connection: amqp.ChannelModel,
    private readonly channel: amqp.ConfirmChannel,
  ) {}

  static async connect(url: string): Promise<AmqpPublisher> {
    const connection = await amqp.connect(url);
    const channel = await connection.createConfirmChannel();
    await channel.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });
    return new AmqpPublisher(connection, channel);
  }

  async publish(events: EventEnvelope[]): Promise<void> {
    for (const e of events) {
      this.channel.publish(EVENTS_EXCHANGE, e.type, Buffer.from(JSON.stringify(e)), {
        persistent: true,
        contentType: 'application/json',
        messageId: e.id,
        type: e.type,
        timestamp: Math.floor(Date.parse(e.occurred_at) / 1000),
        headers: { 'x-tenant-id': e.tenant_id, 'x-event-version': e.version },
        ...(e.correlation_id ? { correlationId: e.correlation_id } : {}),
      });
    }
    await this.channel.waitForConfirms();
  }

  async close(): Promise<void> {
    await this.channel.close().catch(() => undefined);
    await this.connection.close().catch(() => undefined);
  }
}
