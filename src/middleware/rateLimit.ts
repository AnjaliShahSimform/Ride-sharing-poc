import type { Request } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { env } from "../config/env";
import { TooManyRequestsError } from "../lib/AppError";
import { redis } from "../lib/redis";
import { RedisRateLimitStore } from "../lib/redisRateLimitStore";

const enabled = env.RATE_LIMIT_ENABLED ?? true;

interface LimiterOptions {
  // Namespaces this limiter's Redis keys; must be unique per limiter.
  name: string;
  windowMs: number;
  max: number;
  // "ip" (default) suits unauthenticated routes. "user" keys by the JWT
  // subject, so it only works on routes mounted after requireAuth; it falls
  // back to the IP if req.user is somehow absent.
  key?: "ip" | "user";
  // Don't count 2xx responses — used on login so only failed attempts burn
  // the budget.
  skipSuccessfulRequests?: boolean;
  skip?: (req: Request) => boolean;
}

// Builds one limiter. A global limiter and a per-route limiter both run on a
// request that matches both, so the stricter of the two wins — a route
// override can tighten the global limit but never loosen it.
export function createLimiter({ name, windowMs, max, key = "ip", skipSuccessfulRequests, skip }: LimiterOptions) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    // Counters live in Redis when REDIS_URL is set (shared across instances,
    // survive restarts); otherwise express-rate-limit's default in-memory store.
    store: redis ? new RedisRateLimitStore(name) : undefined,
    // Fail open: if Redis is unreachable, let the request through rather than
    // turning a Redis outage into an API outage. RedisRateLimitStore logs the
    // failure (throttled), so the library's per-request console.error is muted.
    passOnStoreError: true,
    logger: { error: () => undefined, warn: () => undefined },
    skipSuccessfulRequests,
    skip: (req) => !enabled || (skip?.(req) ?? false),
    keyGenerator: (req) =>
      key === "user" && req.user ? `user:${req.user.sub}` : ipKeyGenerator(req.ip ?? ""),
    // Hand off to errorHandler so a 429 has the same JSON shape as every
    // other error. express-rate-limit has already set Retry-After by now.
    handler: (_req, _res, next) => next(new TooManyRequestsError()),
  });
}

// Applied to every request in app.ts; /health (Render's probe) and /api-docs
// are exempt so they can never be locked out.
export const globalLimiter = createLimiter({
  name: "global",
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  skip: (req) => req.path === "/health" || req.path.startsWith("/api-docs"),
});

// Per-route overrides. Each is stricter than the global limit on the routes
// where abuse is cheaper or more damaging than ordinary browsing.
export const loginLimiter = createLimiter({
  name: "login",
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
});
// Refresh is called by the frontend on every expired-access 401, so this is
// looser than login but still bounds a stolen-token replay loop.
export const refreshLimiter = createLimiter({ name: "refresh", windowMs: 60 * 1000, max: 30 });
export const signupLimiter = createLimiter({ name: "signup", windowMs: 60 * 60 * 1000, max: 5 });
export const bookingLimiter = createLimiter({ name: "booking", windowMs: 60 * 1000, max: 10, key: "user" });
export const searchLimiter = createLimiter({ name: "search", windowMs: 60 * 1000, max: 60, key: "user" });
export const uploadLimiter = createLimiter({ name: "vehicleUpload", windowMs: 60 * 60 * 1000, max: 20, key: "user" });
// The default limit for every authenticated WRITE (anything but GET/HEAD/OPTIONS),
// mounted once per router right after requireAuth — so a route needs no limiter
// of its own, and a new route is covered without anyone remembering to add one.
// A person has no reason to change state more than a few times a minute, and
// without this a runaway client (a stuck retry loop, a double-click spree) only
// meets the global 300-per-15-minutes cap. One counter per user across all
// routers; a request the service then rejects with a 409 still counts.
//
// Overriding it for one route, as with the global limit: to be STRICTER, add a
// limiter to that route's chain (bookingLimiter, uploadLimiter) — both count, the
// tighter wins; to be looser, exempt the route in the `skip` below.
export const writeLimiter = createLimiter({
  name: "write",
  windowMs: 60 * 1000,
  max: 20,
  key: "user",
  skip: (req) => req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS",
});
