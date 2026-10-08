# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A scheduled ride-sharing / carpool-matching POC (BlaBlaCar-style, not Uber-style — no live GPS, no dispatch, no surge pricing). The authoritative design document is [docs/superpowers/specs/2026-09-26-ride-sharing-matching-design.md](docs/superpowers/specs/2026-09-26-ride-sharing-matching-design.md) — read it before making architectural changes; it documents the two hard requirements (indexed proximity+time matching, race-safe last-seat booking), the full data model, and what's explicitly out of scope. The doc's §9 "Delivery order" tracks module-by-module build sequence: Auth is complete; Rides is partially complete (create/search/cancel/complete built, `GET /:id`, `GET /mine`, and the audit endpoint are not); Bookings and the `AuditLog` wiring have not been started.

## Commands

```bash
npm run dev              # tsx watch src/server.ts
npm run build             # tsc -p tsconfig.json
npm start                 # node dist/server.js (run build first)

npm test                  # vitest run — full suite
npx vitest run <path>      # run a single test file
npx vitest run -t "<name>" # run tests matching a name pattern

npm run prisma:generate   # regenerate Prisma Client after editing schema.prisma
npm run prisma:migrate    # prisma migrate dev (creates + applies a migration)

docker compose up -d db   # start Postgres only, for local `npm run dev` / tests
docker compose up         # full stack (app + db) as it runs in production

npx tsc -p tsconfig.json --noEmit  # type-check without emitting
```

`npm run lint` is defined in package.json but there is no `eslint.config.*` in the repo yet, so it currently fails with "couldn't find configuration file" — set one up before relying on it.

### Local Postgres runs on port 5433, not 5432

`docker-compose.yml` maps the `db` service to host port **5433** (`"5433:5432"`), and `.env`/`.env.example` point at `localhost:5433` accordingly. This is deliberate, not a typo — this dev machine already runs an unrelated project's Postgres container on the standard 5432. When connecting an external DB client (pgAdmin, DBeaver, etc.), point it at 5433.

### The stray `DATABASE_URL` gotcha

This machine has a `DATABASE_URL` exported somewhere in the environment (traced to a Claude Code shell snapshot, not a real profile file) pointing at the *other* project's Postgres container on port 5432. `src/config/env.ts` defends against this for the running app and for tests with `dotenv.config({ override: true })` — `.env` always wins there. **Raw `prisma` CLI commands are not covered** (Prisma's CLI does its own env loading and does not override an existing shell var), so `npx prisma migrate dev`, `migrate deploy`, `migrate status`, etc. run outside `npm run prisma:migrate` need `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/ride_sharing?schema=public` prefixed explicitly or they will silently target the wrong database.

### Two datasource URLs: `DATABASE_URL` vs `DIRECT_URL`

`prisma/schema.prisma`'s datasource block declares both `url` (→ `DATABASE_URL`) and `directUrl` (→ `DIRECT_URL`). Both env vars are required — Prisma validates every env var referenced in the datasource block whenever `PrismaClient` is instantiated, even for commands that don't use `directUrl`. Locally (and in `docker-compose.yml`) they're identical, pointing at the same plain Postgres container. In production against Neon they differ on purpose: `DATABASE_URL` is Neon's **pooled** connection string (used by the running app), `DIRECT_URL` is the **unpooled** one (used only by `prisma migrate`, whose advisory locks don't work reliably through a transaction-mode pooler). If you add a third environment (staging, another hosted Postgres), both vars need setting there too, not just one.

## Architecture

### Module layout

Each domain lives under `src/modules/<name>/` with four files following the same pattern (see `auth/` and `rides/`):

- `*.routes.ts` — Express `Router`, wires middleware to handlers. Mounted in `src/app.ts`.
- `*.controller.ts` — thin HTTP adapter: pulls `req.body`/`req.params`/`req.query`, calls the service, sets the response. No business logic.
- `*.service.ts` — business logic and all Prisma calls. Throws typed errors from `src/lib/AppError.ts`.
- `*.schemas.ts` — Zod schemas for request validation, plus their inferred TypeScript types (`z.infer<...>`).

### Three distinct authorization layers — don't conflate them

1. **Authentication** (`requireAuth` in `src/middleware/auth.middleware.ts`) — verifies the JWT read from the `token` httpOnly cookie (not an `Authorization` header — see "Cookie-based auth" below), populates `req.user` (`{ sub, roles }`).
2. **RBAC / route authorization** (`requireRole(...)`, same file) — "can this *role* call this *route* at all?" Applied per-route.
3. **Ownership / record authorization** — "can this *specific user* act on this *specific record*?" Lives inside the service layer (e.g. `rides.service.ts`'s `transitionRide` checks `ride.driverId !== driverId`), not in middleware, because it needs the record loaded first. This is what prevents IDOR (a rider hitting another user's resource by guessing its ID).

### Error handling

- Route handlers that are `async` must be wrapped in `asyncHandler` (`src/lib/asyncHandler.ts`) so a rejected promise reaches Express's error pipeline — a bare `async (req, res) => {...}` handler will swallow errors otherwise.
- `validateBody(schema)` / `validateQuery(schema)` (`src/middleware/validate.ts`) call `schema.parse(...)` synchronously; a `ZodError` throw is caught natively by Express without needing `asyncHandler`.
- `src/middleware/errorHandler.ts` is the single place HTTP status codes get decided: `ZodError` → 400, any `AppError` subclass → its own `statusCode`, anything else → 500 (and logged, since it's unexpected). It must stay the last `app.use()` in `src/app.ts` — Express only routes to a 4-arg middleware after `next(err)`.
- Add a new failure mode by adding an `AppError` subclass in `src/lib/AppError.ts`, not by special-casing it in the error handler.

### Cookie-based auth, and why GET never needs a CSRF header

The JWT lives only in an `httpOnly` cookie (`src/lib/authCookie.ts`'s
`AUTH_COOKIE_NAME`), never in a response body — `GET /api/auth/me` is the
only way to learn the current user, since JavaScript can't read the cookie
itself. `secure`/`sameSite` differ by environment: production needs
`sameSite: "none"` because the frontend and API deploy as separate Render
services (different sites, not just different origins); local dev uses
`sameSite: "lax"` since `localhost:5173` and `localhost:3000` differ only by
port, which *is* same-site.

`SameSite=None` alone gives no CSRF protection, so `requireCsrfHeader`
(`src/middleware/csrf.ts`), applied globally, rejects any `POST`/`PATCH`/
`PUT`/`DELETE` missing an `X-Requested-With: XMLHttpRequest` header — a
plain cross-site HTML form can't set custom headers, so this blocks the
classic CSRF vector. It never checks `GET`, since `GET` isn't mutating;
full reasoning for this tradeoff vs. a token-based CSRF scheme is in
[2026-10-08-frontend-cookie-auth-design.md](docs/superpowers/specs/2026-10-08-frontend-cookie-auth-design.md)
§3.

Integration tests use Supertest's `request.agent(app)` (not plain
`request(app)`) wherever a cookie needs to persist across multiple
requests — plain `request(app)` doesn't retain cookies between calls.

### Money and matching — two non-obvious data rules from the design spec

- **Money is always `Decimal`, never `Float`**, end-to-end: `estimatedCost` is validated in `rides.schemas.ts` as a regex-checked *string* (`/^\d+(\.\d{1,2})?$/`), not coerced to a JS number, so it never passes through float arithmetic before reaching Prisma's `@db.Decimal(10, 2)` column.
- **Matching is a real indexed query, not an in-memory filter.** `rides.service.ts`'s `searchRides` converts a search radius (km) into a lat/lng bounding box (`KM_PER_DEGREE_LAT = 111`, longitude delta scaled by `cos(latitude)`) and ANDs it with an indexed `departureTime` range — see the `@@index` declarations on `Ride` in `prisma/schema.prisma`. The design doc's §4 documents the PostGIS (`ST_DWithin` + GiST index) upgrade path for when bounding-box approximation stops being good enough; that migration is additive, not a redesign.
- The last-seat booking concurrency guarantee (design spec §5 — a single atomic conditional `UPDATE ... WHERE seatsAvailable > 0`, inside a transaction) is designed but not yet implemented; there is no `Booking` model in `prisma/schema.prisma` yet.

### Testing

- Integration tests (`tests/integration/*.test.ts`) hit a **real** Postgres via Supertest against the actual `app` — no mocking the database. Unit tests (`tests/unit/*.test.ts`) must never touch it.
- `vitest.config.ts` sets `fileParallelism: false` because all integration test files share one database. Each integration file must clean up via the shared `resetDb()` helper in `tests/integration/testDb.ts`, which deletes rows in FK-safe order (children before parents) — extend that helper, not each test file's own `beforeEach`, whenever a new table gets a foreign key, or you'll get a cross-suite foreign-key-violation failure that only reproduces when the full suite runs in a particular order.
- This codebase follows strict TDD: a failing test is written and run first, then the minimal implementation, then refactor. Follow the same discipline for new endpoints.
