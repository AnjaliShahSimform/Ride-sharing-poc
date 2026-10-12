import { startRideExpiryJob } from "./modules/rides/rideExpiry.job";
import { startNotifications, stopNotifications } from "./modules/notifications";

// Everything that runs outside a request: the outbox relay + email consumer
// and the ride expiry job. Started either inside the web process
// (RUN_WORKER_IN_PROCESS=true) or by worker.ts as its own process.
let stopExpiryJob: (() => Promise<void>) | undefined;

export async function startBackgroundJobs() {
  // Expiry first and on its own: it only needs Postgres, so a broker/SMTP
  // problem in startNotifications() must not stop rides from being closed.
  stopExpiryJob = startRideExpiryJob();
  await startNotifications();
}

export async function stopBackgroundJobs() {
  await stopExpiryJob?.();
  stopExpiryJob = undefined;
  await stopNotifications();
}
