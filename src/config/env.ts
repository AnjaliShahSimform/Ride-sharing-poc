import dotenv from "dotenv";
import { z } from "zod";

// override: true — this project's own .env always wins over whatever is
// already exported in the shell (this machine has an unrelated global
// DATABASE_URL set for a different project, which would otherwise silently
// win since dotenv defaults to never clobbering existing env vars).
dotenv.config({ override: true });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "local", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  // Required even though only `prisma migrate` uses it directly — Prisma
  // validates every env var referenced in schema.prisma's datasource block
  // (including directUrl) whenever PrismaClient is instantiated.
  DIRECT_URL: z.string().min(1, "DIRECT_URL is required"),
  // .url() catches a missing/malformed value loudly at startup instead of
  // CORS silently rejecting every credentialed request later. The
  // .transform() strips exactly one trailing slash so a configured value
  // with one (e.g. "https://example.com/") still matches the browser's
  // Origin header, which never has a trailing slash.
  FRONTEND_ORIGIN: z
    .string()
    .url()
    .default("http://localhost:5173")
    .transform((origin) => origin.replace(/\/$/, "")),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  // Access-token (and `token` cookie) lifetime. Kept short because it can't be
  // revoked; the refresh token below is what keeps people signed in.
  JWT_EXPIRES_IN: z.string().default("15m"),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default("7d"),
  // A refresh token presented again within this many seconds of being rotated is
  // treated as a concurrent refresh from another tab, not as theft.
  REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().nonnegative().default(10),
  // Global per-IP rate limit (src/middleware/rateLimit.ts). Individual routes
  // can layer a stricter limit on top via createLimiter().
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  // Unset means "on". The integration suite sets this to "false" in
  // vitest.config.ts (it makes far more logins from one IP than the login
  // limiter allows); NODE_ENV=test can't be used for this because .env's
  // NODE_ENV=development overrides it.
  RATE_LIMIT_ENABLED: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === undefined ? undefined : v === "true"),
  // Email notifications: services write OutboxEvent rows, a relay publishes
  // them to RabbitMQ, a consumer sends them via SMTP. Unset means "on"
  // (vitest.config.ts turns it off for the test suite). Defaults match
  // docker-compose.yml's local rabbitmq + mailpit containers.
  NOTIFICATIONS_ENABLED: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  // Run the relay + consumer inside the web process. Required on Render's
  // free plan (background workers aren't free); set to false and run
  // `node dist/worker.js` as its own process (docker-compose's `worker`).
  RUN_WORKER_IN_PROCESS: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  AMQP_URL: z.string().min(1).default("amqp://guest:guest@localhost:5672"),
  SMTP_HOST: z.string().min(1).default("localhost"),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().min(1).default("Ride Share <no-reply@ride-sharing.local>"),
  // Optional. When set, rate-limit counters live in Redis (shared across
  // instances, survive restarts); when unset they stay in process memory.
  REDIS_URL: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  // Kill switch for Redis even when REDIS_URL is set. vitest.config.ts sets it
  // to "false": REDIS_URL lives in .env (which overrides the shell), and the
  // suite resets the database directly, so a live search cache would serve
  // rides from earlier tests.
  REDIS_ENABLED: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  // Verification gate. Unset means "on": a ride needs an APPROVED vehicle.
  // vitest.config.ts sets "false" so the existing integration suite (which posts
  // rides without a vehicle) keeps passing. Never turn this off in production —
  // server.ts logs a loud warning if it is off.
  REQUIRE_APPROVED_VEHICLE: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  // Phone verification gate (SMS OTP at signup). Unset means "on". Only
  // vitest.config.ts sets "false", so the existing suite — which signs users up
  // and immediately uses the API — keeps passing. Off also means: no SMS sent,
  // nobody gated. Never turn this off in production — server.ts warns if it is.
  REQUIRE_PHONE_VERIFICATION: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  // How verification codes are delivered. "console" just logs the message (no
  // account needed — local dev); "twilio" calls Twilio's REST API and needs the
  // three TWILIO_* vars (sms.ts refuses to boot without them).
  SMS_DRIVER: z.enum(["console", "twilio"]).default("console"),
  TWILIO_ACCOUNT_SID: z.string().optional().transform((v) => v || undefined),
  TWILIO_AUTH_TOKEN: z.string().optional().transform((v) => v || undefined),
  TWILIO_FROM: z.string().optional().transform((v) => v || undefined),
  // S3-compatible object storage for vehicle documents (MinIO locally; any S3
  // API in production — no AWS account needed). All optional: the server boots
  // without them and only the document endpoints answer 503. Uploads go to
  // S3_ENDPOINT; signed download URLs are signed for S3_PUBLIC_ENDPOINT (the
  // host the BROWSER can reach — inside docker the two differ).
  S3_ENDPOINT: z.string().optional().transform((v) => v || undefined),
  S3_PUBLIC_ENDPOINT: z.string().optional().transform((v) => v || undefined),
  S3_BUCKET: z.string().optional().transform((v) => v || undefined),
  S3_ACCESS_KEY: z.string().optional().transform((v) => v || undefined),
  S3_SECRET_KEY: z.string().optional().transform((v) => v || undefined),
  S3_REGION: z.string().min(1).default("us-east-1"),
  // How long after a ride's departure the background job closes it out (rides
  // have no end time): completed if it had confirmed riders, otherwise
  // cancelled as expired. Must stay > 0.
  AUTO_COMPLETE_AFTER_HOURS: z.coerce.number().positive().default(12),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  NOTIFICATIONS_ENABLED: parsed.data.NOTIFICATIONS_ENABLED ?? true,
  REQUIRE_APPROVED_VEHICLE: parsed.data.REQUIRE_APPROVED_VEHICLE ?? true,
  REQUIRE_PHONE_VERIFICATION: parsed.data.REQUIRE_PHONE_VERIFICATION ?? true,
  REDIS_URL: parsed.data.REDIS_ENABLED === false ? undefined : parsed.data.REDIS_URL,
};
