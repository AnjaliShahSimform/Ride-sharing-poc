import type { ChannelModel, ConfirmChannel, ConsumeMessage } from "amqplib";
import { setTimeout as sleep } from "node:timers/promises";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { EXCHANGE, MAX_ATTEMPTS, QUEUE_DEAD, QUEUE_RETRY, QUEUE_SEND } from "./broker";
import { isPermanentMailError, sendMail } from "./mailer";
import { renderEmail } from "./templates";

const PREFETCH = 10;
const INFRA_FAILURE_BACKOFF_MS = 5_000;

interface EmailJob {
  outboxId: string;
  template: string;
  to: string;
  vars: unknown;
}

let channel: ConfirmChannel | undefined;
let consumerTag: string | undefined;
const inFlight = new Set<Promise<void>>();

function parseJob(msg: ConsumeMessage): EmailJob | undefined {
  try {
    const job = JSON.parse(msg.content.toString());
    if (typeof job?.outboxId === "string" && typeof job.template === "string" && typeof job.to === "string") {
      return job;
    }
  } catch {
    // fall through
  }
  return undefined;
}

// Re-publishes the same body to another queue and waits for the broker to
// confirm it — only then is it safe to ack the original.
async function forward(ch: ConfirmChannel, msg: ConsumeMessage, queue: string, headers: Record<string, unknown>) {
  ch.publish(EXCHANGE, queue, msg.content, {
    persistent: true,
    contentType: "application/json",
    messageId: msg.properties.messageId,
    headers: { ...msg.properties.headers, ...headers },
  });
  await ch.waitForConfirms();
}

function deadLetter(ch: ConfirmChannel, msg: ConsumeMessage, reason: string) {
  logger.error({ messageId: msg.properties.messageId, reason }, "Email moved to dead-letter queue");
  return forward(ch, msg, QUEUE_DEAD, { "x-error": reason });
}

function retryOrDeadLetter(ch: ConfirmChannel, msg: ConsumeMessage, reason: string) {
  const attempts = Number(msg.properties.headers?.["x-attempts"] ?? 0) + 1;
  if (attempts >= MAX_ATTEMPTS) {
    return deadLetter(ch, msg, `gave up after ${attempts} attempts: ${reason}`);
  }
  logger.warn({ messageId: msg.properties.messageId, attempts, reason }, "Email send failed; scheduling retry");
  return forward(ch, msg, QUEUE_RETRY, { "x-attempts": attempts, "x-error": reason });
}

// Handles one delivery. Anything that throws out of here is an
// infrastructure failure (broker/DB), not a bad email — handleDelivery
// requeues the message for that case.
async function processDelivery(ch: ConfirmChannel, msg: ConsumeMessage) {
  const job = parseJob(msg);
  if (!job) {
    await deadLetter(ch, msg, "unparseable message");
    return;
  }

  // At-least-once delivery means the same outbox row can arrive twice (relay
  // republished after a failed batch). `sentAt` is the dedupe record.
  const existing = await prisma.outboxEvent.findUnique({ where: { id: job.outboxId }, select: { sentAt: true } });
  if (existing?.sentAt) {
    logger.info({ outboxId: job.outboxId }, "Email already sent; skipping duplicate delivery");
    return;
  }

  let rendered;
  try {
    rendered = renderEmail(job.template, job.vars);
  } catch (err) {
    await deadLetter(ch, msg, `template render failed: ${(err as Error).message}`);
    return;
  }
  if (!rendered) {
    await deadLetter(ch, msg, `unknown template ${job.template}`);
    return;
  }

  try {
    await sendMail({ to: job.to, ...rendered });
  } catch (err) {
    const reason = (err as Error).message;
    await (isPermanentMailError(err) ? deadLetter(ch, msg, reason) : retryOrDeadLetter(ch, msg, reason));
    return;
  }

  logger.info({ outboxId: job.outboxId, template: job.template }, "Email sent");
  // The email is already out; failing to stamp it must not requeue the
  // message (that would send it again), so just log.
  await prisma.outboxEvent
    .updateMany({ where: { id: job.outboxId }, data: { sentAt: new Date() } })
    .catch((err) => logger.warn({ err, outboxId: job.outboxId }, "Failed to record sentAt after sending"));
}

async function handleDelivery(ch: ConfirmChannel, msg: ConsumeMessage) {
  try {
    await processDelivery(ch, msg);
    ch.ack(msg);
  } catch (err) {
    logger.error({ err, messageId: msg.properties.messageId }, "Email delivery handling failed; requeueing");
    await sleep(INFRA_FAILURE_BACKOFF_MS); // avoid a hot redelivery loop while the DB/broker is down
    try {
      ch.nack(msg, false, true);
    } catch {
      // Channel already closed: the broker redelivers unacked messages itself.
    }
  }
}

// Called from the broker's `setup`, i.e. again after every reconnect.
export async function startConsumer(model: ChannelModel) {
  const ch = await model.createConfirmChannel();
  ch.on("error", (err: Error) => logger.warn({ err }, "RabbitMQ consumer channel error"));
  await ch.prefetch(PREFETCH);
  const { consumerTag: tag } = await ch.consume(QUEUE_SEND, (msg) => {
    if (!msg) {
      logger.warn("RabbitMQ cancelled the email consumer");
      return;
    }
    const work = handleDelivery(ch, msg).finally(() => inFlight.delete(work));
    inFlight.add(work);
  });
  channel = ch;
  consumerTag = tag;
}

// Stop taking new messages, then let in-flight ones finish before the
// connection closes.
export async function stopConsumer() {
  try {
    if (channel && consumerTag) {
      await channel.cancel(consumerTag);
    }
  } catch (err) {
    logger.warn({ err }, "Failed to cancel email consumer");
  }
  await Promise.allSettled([...inFlight]);
  channel = undefined;
  consumerTag = undefined;
}
