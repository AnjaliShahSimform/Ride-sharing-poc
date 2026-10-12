import type { IncrementResponse, Options, Store } from "express-rate-limit";
import { logger } from "./logger";
import { redis } from "./redis";

// Atomic fixed-window counter: first hit in a window sets the key with a TTL of
// windowMs, later hits INCR it. Returns {hits, msUntilExpiry}. Running it as
// one Lua script (not GET-then-SET) is what keeps concurrent requests from
// losing counts.
const INCREMENT_SCRIPT = `
local ttl = redis.call("PTTL", KEYS[1])
if ttl <= 0 then
  redis.call("SET", KEYS[1], 1, "PX", ARGV[1])
  return { 1, tonumber(ARGV[1]) }
end
return { redis.call("INCR", KEYS[1]), ttl }
`;

// Errors are throttled to one log line per interval: during an outage every
// request would otherwise log its own failure.
const LOG_INTERVAL_MS = 30_000;
let lastLoggedAt = 0;

// express-rate-limit Store backed by Redis. Written in-house instead of using
// rate-limit-redis because that package loads its Lua scripts in init() and
// every request awaits that load — with Redis down at boot, requests would
// hang (or the rejected load would disable limiting for good). Here a failed
// call just throws, and the limiters' `passOnStoreError: true` turns that
// into "allow the request".
export class RedisRateLimitStore implements Store {
  private windowMs = 0;

  // `name` namespaces the keys ("rl:login:<ip>") so limiters sharing one
  // Redis never share counters.
  constructor(private readonly name: string) {}

  init(options: Options) {
    this.windowMs = options.windowMs;
  }

  private key(clientKey: string) {
    return `rl:${this.name}:${clientKey}`;
  }

  async increment(clientKey: string): Promise<IncrementResponse> {
    try {
      const reply = (await redis!.eval(INCREMENT_SCRIPT, {
        keys: [this.key(clientKey)],
        arguments: [String(this.windowMs)],
      })) as [number, number];
      const [totalHits, msUntilExpiry] = reply;
      return { totalHits, resetTime: new Date(Date.now() + msUntilExpiry) };
    } catch (err) {
      if (Date.now() - lastLoggedAt > LOG_INTERVAL_MS) {
        lastLoggedAt = Date.now();
        logger.warn({ err }, "Rate-limit store unavailable; allowing requests without limiting");
      }
      throw err;
    }
  }

  // Used by skipSuccessfulRequests (login): hands back the hit a successful
  // request just spent. Best-effort — if Redis is down it just doesn't refund.
  async decrement(clientKey: string) {
    await redis!.decr(this.key(clientKey)).catch(() => undefined);
  }

  async resetKey(clientKey: string) {
    await redis!.del(this.key(clientKey));
  }
}
