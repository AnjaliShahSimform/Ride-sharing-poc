import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Unit test only — never touches the database. Mocks dotenv so the real
// .env file (which sets FRONTEND_ORIGIN without a trailing slash) can't
// override the value this test deliberately sets on process.env.
const REQUIRED_ENV = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5433/ride_sharing?schema=public",
  DIRECT_URL: "postgresql://postgres:postgres@localhost:5433/ride_sharing?schema=public",
  JWT_SECRET: "test-secret-at-least-16-chars",
};

describe("env.FRONTEND_ORIGIN", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.doMock("dotenv", () => ({ default: { config: vi.fn() } }));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.doUnmock("dotenv");
  });

  it("strips a single trailing slash so it matches a browser's Origin header", async () => {
    process.env = {
      ...process.env,
      ...REQUIRED_ENV,
      FRONTEND_ORIGIN: "https://example.com/",
    };

    const { env } = await import("../../src/config/env");

    expect(env.FRONTEND_ORIGIN).toBe("https://example.com");
  });
});
