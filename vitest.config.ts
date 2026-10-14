import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // .env sets NODE_ENV=development and src/config/env.ts loads it with
    // `override: true`, so NODE_ENV here is clobbered back to "development"
    // and can't be relied on to switch features off. The explicit flags below
    // aren't in .env, so they survive. Rate limiting would 429 the many
    // logins/signups the suite makes from one IP; notifications would write
    // outbox rows nothing consumes; Redis would cache searches across tests.
    // REQUIRE_APPROVED_VEHICLE=false: the existing suite posts rides with no
    // vehicle; verification is off for it by design.
    env: {
      NODE_ENV: "test",
      RATE_LIMIT_ENABLED: "false",
      NOTIFICATIONS_ENABLED: "false",
      REDIS_ENABLED: "false",
      REQUIRE_APPROVED_VEHICLE: "false",
    },
    fileParallelism: false, // integration tests share one real database
    exclude: [...configDefaults.exclude, "web/**"],
  },
});
