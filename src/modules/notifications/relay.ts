import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { EXCHANGE, QUEUE_SEND, getPublisher } from "./broker";

const POLL_INTERVAL_MS = 2_000;
const BATCH_SIZE = 50;

interface OutboxRow {
  id: string;
  template: string;
  toEmail: string;
  vars: unknown;
}

// Publishes one batch of unpublished OutboxEvent rows. Returns how many it
// handled (0 when idle or while RabbitMQ is unreachable).
//
// FOR UPDATE SKIP LOCKED makes this safe with several app instances: each
// claims a disjoint set of rows, and a row is only marked published after
// RabbitMQ confirmed it. If anything fails mid-batch the transaction rolls
// back and the rows are simply retried next tick — which can republish a
// message RabbitMQ already accepted, so the consumer dedupes on `sentAt`.
async function relayBatch(): Promise<number> {
  const channel = getPublisher();
  if (!channel) {
    return 0;
  }

  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<OutboxRow[]>`
      SELECT "id", "template", "toEmail", "vars"
      FROM "OutboxEvent"
      WHERE "publishedAt" IS NULL
      ORDER BY "createdAt"
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED`;
    if (rows.length === 0) {
      return 0;
    }

    for (const row of rows) {
      const body = Buffer.from(
        JSON.stringify({ outboxId: row.id, template: row.template, to: row.toEmail, vars: row.vars }),
      );
      channel.publish(EXCHANGE, QUEUE_SEND, body, {
        persistent: true,
        contentType: "application/json",
        messageId: row.id,
      });
    }
    await channel.waitForConfirms();

    await tx.outboxEvent.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { publishedAt: new Date() },
    });
    return rows.length;
  });
}

// Polls the outbox until the returned stop function is called. A full batch
// means there's probably more waiting, so it loops again immediately.
export function startRelay(): () => Promise<void> {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> = Promise.resolve();

  async function tick() {
    let delay = POLL_INTERVAL_MS;
    try {
      const handled = await relayBatch();
      if (handled === BATCH_SIZE) {
        delay = 0;
      }
    } catch (err) {
      logger.error({ err }, "Outbox relay batch failed; will retry");
    }
    if (!stopped) {
      timer = setTimeout(() => {
        inFlight = tick();
      }, delay);
    }
  }

  inFlight = tick();

  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await inFlight;
  };
}
