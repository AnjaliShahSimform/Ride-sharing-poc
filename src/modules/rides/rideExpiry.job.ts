import { logger } from "../../lib/logger";
import { closeExpiredRides } from "./rides.service";

const INTERVAL_MS = 5 * 60 * 1000;

// Periodic loop, same shape as the notifications relay: one run immediately
// (so a process that was asleep or down catches up as soon as it's back), then
// every INTERVAL_MS. The work is "everything past the cutoff right now", not a
// per-ride timer, so missed ticks cost nothing but delay. Returns a stop
// function that waits for an in-flight run to finish.
export function startRideExpiryJob(): () => Promise<void> {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> = Promise.resolve();

  async function tick() {
    try {
      const closed = await closeExpiredRides();
      if (closed > 0) {
        logger.info({ closed }, "Closed expired rides");
      }
    } catch (err) {
      logger.error({ err }, "Ride expiry run failed; will retry next interval");
    }
    if (!stopped) {
      timer = setTimeout(() => {
        inFlight = tick();
      }, INTERVAL_MS);
    }
  }

  inFlight = tick();

  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await inFlight;
  };
}
