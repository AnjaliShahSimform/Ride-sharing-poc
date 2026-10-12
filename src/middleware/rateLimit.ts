import type { Request } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { env } from "../config/env";
import { TooManyRequestsError } from "../lib/AppError";

const enabled = env.RATE_LIMIT_ENABLED ?? env.NODE_ENV !== "test";

interface LimiterOptions {
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
export function createLimiter({ windowMs, max, key = "ip", skipSuccessfulRequests, skip }: LimiterOptions) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
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
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  skip: (req) => req.path === "/health" || req.path.startsWith("/api-docs"),
});

// Per-route overrides. Each is stricter than the global limit on the routes
// where abuse is cheaper or more damaging than ordinary browsing.
export const loginLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
});
export const signupLimiter = createLimiter({ windowMs: 60 * 60 * 1000, max: 5 });
export const bookingLimiter = createLimiter({ windowMs: 60 * 1000, max: 10, key: "user" });
export const searchLimiter = createLimiter({ windowMs: 60 * 1000, max: 60, key: "user" });
