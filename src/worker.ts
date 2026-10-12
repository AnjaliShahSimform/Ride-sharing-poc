import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { startBackgroundJobs, stopBackgroundJobs } from "./background";

// Standalone entry point: runs only the background jobs (outbox relay + email
// consumer, ride expiry), no HTTP server. Use it (with RUN_WORKER_IN_PROCESS=false on the web process)
// wherever a separate worker process is available — docker-compose's
// `worker` service does exactly that.
async function main() {
  await startBackgroundJobs();
}

async function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down worker`);
  await stopBackgroundJobs();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

main().catch((err) => {
  logger.error({ err }, "Worker failed to start");
  process.exit(1);
});
