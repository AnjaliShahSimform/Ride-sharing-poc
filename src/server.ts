import { app } from "./app";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { startNotifications, stopNotifications } from "./modules/notifications";

const server = app.listen(env.PORT, () => {
  logger.info(`Server listening on port ${env.PORT}`);
});

if (env.RUN_WORKER_IN_PROCESS) {
  // A broker/SMTP problem must never take the API down, so failure to start
  // is logged, not fatal.
  startNotifications().catch((err) => logger.error({ err }, "Failed to start email notifications"));
}

async function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down gracefully`);
  server.close(async () => {
    if (env.RUN_WORKER_IN_PROCESS) {
      await stopNotifications();
    }
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
