import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import { closeBroker, connectBroker } from "./broker";
import { startConsumer, stopConsumer } from "./consumer";
import { closeMailer } from "./mailer";
import { startRelay } from "./relay";

let stopRelay: (() => Promise<void>) | undefined;

// Starts the outbox relay and the email consumer. Safe to call when
// notifications are disabled (no-op), and safe if RabbitMQ is down — the
// broker connection keeps retrying in the background while the relay waits
// for a publish channel.
export async function startNotifications() {
  if (!env.NOTIFICATIONS_ENABLED) {
    logger.info("Email notifications disabled");
    return;
  }
  await connectBroker(startConsumer);
  stopRelay = startRelay();
  logger.info("Email notifications started");
}

export async function stopNotifications() {
  await stopRelay?.();
  stopRelay = undefined;
  await stopConsumer();
  await closeBroker();
  await closeMailer();
}
