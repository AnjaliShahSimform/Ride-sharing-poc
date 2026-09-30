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
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  JWT_EXPIRES_IN: z.string().default("1d"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
