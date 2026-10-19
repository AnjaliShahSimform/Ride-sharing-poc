import { app } from "./app";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import "./lib/sms";
import { prisma } from "./lib/prisma";
import { closeRedis } from "./lib/redis";
import { startBackgroundJobs, stopBackgroundJobs } from "./background";

const server = app.listen(env.PORT, () => {
  logger.info(`Server listening on port ${env.PORT}`);
});

if (!env.REQUIRE_APPROVED_VEHICLE) {
  logger.warn("REQUIRE_APPROVED_VEHICLE=false: rides can be posted without an approved vehicle");
}

if (!env.REQUIRE_PHONE_VERIFICATION) {
  logger.warn("REQUIRE_PHONE_VERIFICATION=false: accounts are not required to verify their phone");
}
if (env.REQUIRE_PHONE_VERIFICATION && env.SMS_DRIVER === "console" && env.NODE_ENV === "production") {
  logger.warn("SMS_DRIVER=console in production: verification codes are only logged, nobody receives them");
}

if (env.RUN_WORKER_IN_PROCESS) {
  // A broker/SMTP problem must never take the API down, so failure to start
  // is logged, not fatal.
  startBackgroundJobs().catch((err) => logger.error({ err }, "Failed to start background jobs"));
}

async function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down gracefully`);
  server.close(async () => {
    if (env.RUN_WORKER_IN_PROCESS) {
      await stopBackgroundJobs();
    }
    await closeRedis();
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
