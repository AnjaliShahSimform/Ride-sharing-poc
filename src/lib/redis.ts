import { createClient } from "redis";
import { env } from "../config/env";
import { logger } from "./logger";

// undefined when REDIS_URL isn't set — callers must treat Redis as optional.
//
// disableOfflineQueue makes commands fail immediately while the connection is
// down instead of queueing until it returns. That is what keeps the API fast
// during a Redis outage: the rate limiter's call errors out in microseconds and
// the request is let through (fail open), rather than hanging on a queue.
// reconnectStrategy keeps retrying in the background, capped at 5s between
// attempts.
export const redis = env.REDIS_URL
  ? createClient({
      url: env.REDIS_URL,
      disableOfflineQueue: true,
      socket: { reconnectStrategy: (retries) => Math.min(retries * 200, 5_000) },
    })
  : undefined;

if (redis) {
  // An unhandled 'error' event would crash the process. node-redis emits one
  // per failed reconnect attempt (every 0.2-5s), so log the first of an outage
  // in full, then only a one-line reminder every 30s; "ready" resets this so
  // the next outage is reported immediately.
  let lastLoggedAt = 0;
  redis.on("error", (err) => {
    const now = Date.now();
    if (lastLoggedAt === 0) {
      logger.warn({ err }, "Redis unavailable; rate limiting and search caching are bypassed until it reconnects");
    } else if (now - lastLoggedAt > 30_000) {
      logger.warn({ code: (err as { code?: string }).code }, "Redis still unavailable");
    } else {
      return;
    }
    lastLoggedAt = now;
  });
  redis.on("ready", () => {
    lastLoggedAt = 0;
    logger.info("Connected to Redis");
  });
  // Don't await: the server must boot (and serve, unlimited) even if Redis is
  // down. The first failed attempt is logged by the 'error' handler above.
  redis.connect().catch(() => undefined);
}

export async function closeRedis() {
  if (redis?.isOpen) {
    await redis.close();
  }
}
