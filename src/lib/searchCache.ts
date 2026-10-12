import { createHash } from "node:crypto";
import { logger } from "./logger";
import { redis } from "./redis";

// Cache for GET /api/rides/search, invalidated by a generation counter.
//
// Every cache key embeds the current value of GEN_KEY. A write that changes
// what a search could return calls invalidateSearchCache() AFTER its
// transaction commits, which INCRs GEN_KEY — that makes every existing entry
// unreachable at once. A counter is used instead of deleting keys because
// deletion has a race: a searcher reads the old data, the write commits and
// deletes the key, then the searcher stores its old data — now stale until
// the TTL. With a counter the searcher reads the generation BEFORE it queries
// the database and stores under that generation's key, so a late store lands
// on a key nobody reads again.
//
// Optional and fail-open throughout: with no REDIS_URL, or any Redis error,
// searches just go to Postgres.
const GEN_KEY = "search:gen";
// Old-generation entries are never read again; this lets Redis reclaim them.
// It is also the safety net bounding staleness if an invalidation INCR fails.
const TTL_SECONDS = 60;
const LOG_INTERVAL_MS = 30_000;
let lastLoggedAt = 0;

function logThrottled(err: unknown, message: string) {
  if (Date.now() - lastLoggedAt > LOG_INTERVAL_MS) {
    lastLoggedAt = Date.now();
    logger.warn({ err }, message);
  }
}

// `params` must contain everything the result depends on. Exact values, no
// rounding: the locations come from the picker so identical searches already
// have identical numbers, and the cached result is never computed from
// coordinates slightly different from the ones the user sent.
//
// The value returned on a hit went through JSON, so e.g. Dates come back as
// ISO strings and Decimals as strings — identical to what res.json() sends
// anyway, which is the only consumer.
export async function withSearchCache<T>(params: string, load: () => Promise<T>): Promise<T> {
  if (!redis) {
    return load();
  }

  let cacheKey: string;
  try {
    // Must be read before load() — see the race described above.
    const generation = (await redis.get(GEN_KEY)) ?? "0";
    cacheKey = `search:${generation}:${createHash("sha256").update(params).digest("hex")}`;
    const hit = await redis.get(cacheKey);
    if (hit !== null) {
      return JSON.parse(hit) as T;
    }
  } catch (err) {
    logThrottled(err, "Search cache unavailable; querying the database directly");
    return load();
  }

  const result = await load();
  try {
    await redis.set(cacheKey, JSON.stringify(result), { EX: TTL_SECONDS });
  } catch (err) {
    logThrottled(err, "Failed to store search result in cache");
  }
  return result;
}

export async function invalidateSearchCache() {
  if (!redis) {
    return;
  }
  try {
    await redis.incr(GEN_KEY);
  } catch (err) {
    logThrottled(err, "Failed to invalidate search cache; stale results possible for up to 60s");
  }
}

// Runs a write (normally a prisma.$transaction) and invalidates only if it
// succeeded — a rolled-back or failed write changed nothing, so the cache is
// still right.
export async function invalidateSearchCacheAfter<T>(write: Promise<T>): Promise<T> {
  const result = await write;
  await invalidateSearchCache();
  return result;
}
