import amqp, { type ChannelModel, type ConfirmChannel, type RecoveringChannelModel } from "amqplib";
import { env } from "../../config/env";
import { logger } from "../../lib/logger";

export const EXCHANGE = "notifications";
export const QUEUE_SEND = "email.send";
export const QUEUE_RETRY = "email.retry";
export const QUEUE_DEAD = "email.dead";
export const RETRY_DELAY_MS = 30_000;
export const MAX_ATTEMPTS = 5;

// Topology:
//   notifications (direct exchange)
//     key email.send  -> email.send   (consumer reads here)
//     key email.retry -> email.retry  (no consumer; messages sit RETRY_DELAY_MS,
//                                      then dead-letter back to email.send)
//     key email.dead  -> email.dead   (parked for a human; never consumed)
// The retry queue's TTL + dead-letter routing is RabbitMQ's built-in way to
// get a delayed redelivery without a plugin.
async function assertTopology(ch: ConfirmChannel) {
  await ch.assertExchange(EXCHANGE, "direct", { durable: true });

  await ch.assertQueue(QUEUE_SEND, { durable: true });
  await ch.bindQueue(QUEUE_SEND, EXCHANGE, QUEUE_SEND);

  await ch.assertQueue(QUEUE_RETRY, {
    durable: true,
    arguments: {
      "x-message-ttl": RETRY_DELAY_MS,
      "x-dead-letter-exchange": EXCHANGE,
      "x-dead-letter-routing-key": QUEUE_SEND,
    },
  });
  await ch.bindQueue(QUEUE_RETRY, EXCHANGE, QUEUE_RETRY);

  await ch.assertQueue(QUEUE_DEAD, { durable: true });
  await ch.bindQueue(QUEUE_DEAD, EXCHANGE, QUEUE_DEAD);
}

let connection: RecoveringChannelModel | undefined;
let publisher: ConfirmChannel | undefined;

// The relay's (and consumer's retry/dead-letter) publish channel. Undefined
// between a disconnect and the next successful reconnect — callers treat that
// as "try again later", not as an error.
export function getPublisher(): ConfirmChannel | undefined {
  return publisher;
}

// Connects with amqplib's built-in recovery: it reconnects with backoff and
// re-runs `setup` after every reconnect, which is where channels, topology
// and consumers get recreated. Doesn't wait for the first connection, so the
// web server still boots (and serves requests) while RabbitMQ is down; the
// outbox simply accumulates until it comes back.
export async function connectBroker(onConnected: (model: ChannelModel) => Promise<void>) {
  connection = await amqp.connect(env.AMQP_URL, {
    recovery: {
      initialDelay: 500,
      maxDelay: 30_000,
      waitForConnect: false,
      async setup(model: ChannelModel) {
        const ch = await model.createConfirmChannel();
        ch.on("error", (err: Error) => logger.warn({ err }, "RabbitMQ publisher channel error"));
        ch.on("close", () => {
          if (publisher === ch) publisher = undefined;
        });
        await assertTopology(ch);
        publisher = ch;
        await onConnected(model);
      },
    },
  });

  connection.on("connect", () => logger.info("Connected to RabbitMQ"));
  connection.on("disconnect", (err: Error) => logger.warn({ err }, "Disconnected from RabbitMQ"));
  connection.on("reconnect-scheduled", ({ attempt, delay }: { attempt: number; delay: number }) =>
    logger.warn({ attempt, delay }, "Reconnecting to RabbitMQ"),
  );
  // Without an 'error' listener Node would throw on an emitted error.
  connection.on("error", (err: Error) => logger.error({ err }, "RabbitMQ connection error"));
}

export async function closeBroker() {
  publisher = undefined;
  await connection?.close();
  connection = undefined;
}
