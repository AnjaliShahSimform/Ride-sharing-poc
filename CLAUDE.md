# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A scheduled ride-sharing / carpool-matching POC (BlaBlaCar-style, not Uber-style — no live GPS, no dispatch, no surge pricing). The authoritative design document is [docs/superpowers/specs/2026-09-26-ride-sharing-matching-design.md](docs/superpowers/specs/2026-09-26-ride-sharing-matching-design.md) — read it before making architectural changes; it documents the two hard requirements (indexed proximity+time matching, race-safe last-seat booking), the full data model, and what's explicitly out of scope. The doc's §9 "Delivery order" tracks module-by-module build sequence: Auth is complete; Rides is complete except `GET /:id`; Bookings is complete (race-safe seat booking, cancellation, cost splitting, contact visibility on confirmed match) per [2026-10-09-booking-module-design.md](docs/superpowers/specs/2026-10-09-booking-module-design.md); the `AuditLog` wiring is complete; the frontend (`web/`) is complete for everything the backend currently supports. The `ADMIN` role, previously schema-only, is now wired to a read-only `src/modules/admin/` module (see "Admin module" below). Vehicle verification (vehicles, RC/licence documents, admin review, vehicle linked to rides) is complete per [2026-10-14-vehicle-verification-design.md](docs/superpowers/specs/2026-10-14-vehicle-verification-design.md). Phone verification (SMS OTP at signup) is complete per [2026-10-15-phone-verification-design.md](docs/superpowers/specs/2026-10-15-phone-verification-design.md).

### Admin module

`ADMIN` has no self-service signup path — `auth.schemas.ts`'s `signupSchema` only
accepts `DRIVER`/`RIDER`. The one admin account is created directly (the seed
script's `admin@example.com` / `password123`, or a manual `prisma.user.create`
in production), then logs in through the ordinary `/api/auth/login` endpoint
like anyone else. `src/modules/admin/` is read-only and `requireRole("ADMIN")`-gated
on every route. Every list — `GET /api/admin/users`, `/rides`, `/audit-logs`
and `/vehicles` — is server-side paginated (`page`, `pageSize` ≤ 200, default
50) and returns one envelope, `{ items, total, page, pageSize }`; rows are
ordered newest-first (vehicles oldest-first) with `id` as a tiebreaker so pages
never overlap. Filters (AND-combined, validated in `admin.schemas.ts`): users
`role`, `q` (name/email/phone), `joinedFrom/joinedTo`; rides `status`, `q`
(route label or driver name/email), `departureFrom/departureTo`; audit logs
`entityType`, `action`, `from/to`; vehicles `status`. Date filters are
`YYYY-MM-DD` read as **IST calendar days**, both ends inclusive
(`lib/rideTime.ts`'s `istDayStart`/`istDayEndExclusive`); an inverted range or
an impossible date is a 400. `/users` never returns `passwordHash`; `/rides`
returns every ride with a nested `driver`. On the
frontend, `Layout.tsx` shows the "Users" / "All rides" / "Vehicle review" /
"Audit log" nav links only when `roles` includes `ADMIN`. Admin list pages share
`hooks/useListParams.ts` (page, page size and filters live in the **URL query
string**, so views survive refresh and can be linked; changing a filter resets to
page 1; `useClampPage` jumps back from a past-the-end page) and
`components/admin/` (`FilterBar`, `Pagination`, `ListMessages`). Landing pages come from one helper,
`web/src/lib/homePath.ts`'s `homePathFor(roles)`, used by `/`, login and signup:
admin-only → `/admin/users`, driver-only → `/rides/mine`, everyone else
(riders) → `/rides`. "Search rides" (nav link and the `/rides` route, via
`RiderOnly` in `main.tsx`) is rider-only, since only a `RIDER` can book; a
driver who opens `/rides` is redirected home. The backend search endpoint itself
stays open to any authenticated user.

### Profile

Every logged-in user has `/profile` (`ProfilePage.tsx`) and a name chip in the
navbar linking to it. `GET /api/auth/me` now also returns `createdAt`, and
`PATCH /api/auth/me` edits **name only** (strict schema: `email`, `phone`,
`roles` or any other key is a 400 — email is the login identity, roles are an
authorization decision). The phone is fixed at signup because it is the
verified number (see "Phone verification"). Password/email change is not
implemented.

### Phone verification (SMS OTP)

Design: [spec](docs/superpowers/specs/2026-10-15-phone-verification-design.md),
[plan](docs/superpowers/plans/2026-10-15-phone-verification.md). A new account
must prove it controls its phone: signup creates the user **unverified**,
issues the cookies as usual, then texts a 6-digit code; until it is entered the
account can log in but reach nothing except `/verify-phone`. Phone only (no
email OTP). Phones are validated as Indian mobiles and stored as
`+91XXXXXXXXXX` (`src/lib/phone.ts`); existing rows were backfilled as verified
by the migration and keep their old format. Logic is
`src/modules/auth/phoneVerification.service.ts`.

- **`PhoneVerification`** (one row per user): `codeHash` is an HMAC-SHA256 of
  `userId:code` keyed with `JWT_SECRET` — never the code, and not a plain hash,
  which a million-value code space would reverse instantly. Code valid 10 min,
  5 wrong attempts, 60 s resend cooldown, 5 sends/hour (`sendCount` +
  `sendWindowStart`). Resend replaces the code and resets `attempts`. Success
  sets `User.phoneVerifiedAt`, deletes the row and re-signs the access cookie.
- **Verify is row-locked.** `verifyCode` runs `SELECT … FOR UPDATE` on the
  user's `PhoneVerification` row, so parallel guesses are counted one by one and
  can't beat the attempt cap (same idea as `bookSeat`); `sendCode` takes the same
  lock for the cooldown/hourly check. A wrong guess's `attempts` increment must
  **commit**, so the transaction *returns* an outcome (`OK | NO_CODE | EXPIRED |
  LOCKED | WRONG`) and only afterwards turns it into an error — throwing inside
  would roll the increment back and make the cap meaningless. Hashes compare with
  `timingSafeEqual`. A wrong code is 400, a locked one 429; already verified 409.
- **The gate is `requireAuth` itself**, via a `phoneVerified` claim in the access
  JWT: `phoneVerified === false` → `PhoneNotVerifiedError` (403, body
  `error: "PhoneNotVerifiedError"`), so every present and future route is covered
  by default (same philosophy as `writeLimiter`). Only `requireAuthAllowUnverified`
  skips it, used by exactly `GET/PATCH /me`, `POST /verify-phone` and
  `POST /verify-phone/resend` (both also behind `writeLimiter` + a per-user
  `otpLimiter`, 10/min; the DB caps are the real control). A token with **no**
  claim counts as verified (pre-feature tokens, ≤ 15 min, belong to grandfathered
  users). `ADMIN` is exempt (never signs up). The claim is computed by
  `isPhoneVerified()` and re-read from the DB on login/refresh/verify; `/me`,
  login, signup and refresh all return `phoneVerified`. **`REQUIRE_PHONE_VERIFICATION`**
  (default on): off means nobody is gated and no SMS is sent; only
  `vitest.config.ts` sets it `false` (so the existing signup tests keep passing
  untouched), and the server warns at boot if it is off. Never set it false in
  production.
- **`SMS_DRIVER=console|twilio`** (`src/lib/sms.ts`, default `console`). Console
  logs the message **including the code** — with it, the OTP appears in the
  `npm run dev` terminal output (the boot warns if it's used with
  `NODE_ENV=production`). `twilio` is a plain `fetch` to Twilio's Messages API
  (no SDK); it needs `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_FROM` and
  throws at boot without them. Any send failure becomes a 502 `SmsDeliveryError`
  (cause logged only). Twilio *trial* accounts only text numbers verified in the
  Twilio console, prefix messages "Sent from your Twilio trial account", and
  whether they deliver to India without DLT registration is **unconfirmed**.
- **SMS is sent directly from the request after the DB write commits, not via
  the outbox** (a code is useless minutes later, and the outbox is email-shaped).
  If the send fails the code row is still valid: at signup the failure is logged
  and signup succeeds; on Resend the user gets the 502 and retries after the
  cooldown.
- **Retry-After and CORS.** The rate-limiter 429s, the resend-cooldown 429 and
  the hourly-cap 429 carry `Retry-After`; the wrong-attempts LOCKED 429 does not
  (the user must request a new code, there's nothing to wait out). It isn't a
  CORS-safelisted header, so `src/app.ts`'s `cors()` sets
  `exposedHeaders: ["Retry-After"]` — without it the browser can't read it
  cross-origin and the Resend countdown on `VerifyPhonePage` breaks.
  `web/src/lib/api.ts` reads it with `res.headers?.get("Retry-After")` (optional
  chaining, because the existing `api.test.ts` mocks have no `headers`).
- **Frontend:** `RequireAuth` sends an unverified user to `/verify-phone` from
  every page and a verified one away from it; `apiFetch` invalidates the
  `currentUser` query on a `PhoneNotVerifiedError` 403 so a stale tab lands there
  too. `VerifyPhonePage` shows the masked number, a Resend button with the
  cooldown, and a log-out link.
- **Known limits** (spec §10): a wrong number at signup can't be corrected (the
  phone is fixed, so that account can never verify — sign up again with another
  email, or an admin edits the row; the cheap fix, if it bites, is to allow
  changing it while unverified); no one-account-per-phone rule (existing data has
  duplicates); someone can register another person's number and make them
  receive a code (only the signup limit and per-user resend cap mitigate it —
  SMS-pumping protection is out of scope).
- **Testing it by hand.** The rate limiters are Redis-backed and persist across
  dev-server restarts, and `signupLimiter` (5/hour/IP) also counts requests that
  fail validation, so repeated hands-on signups hit it. Clear only the limiter
  keys: `docker exec ride-sharing-poc-redis-1 sh -c "redis-cli --scan --pattern
  'rl:*' | xargs -r redis-cli del"`. To get a throwaway account's code without
  the log, brute-force the stored `codeHash` against all 10^6 codes with the
  HMAC and `JWT_SECRET` — which is why that secret matters. Delete the throwaway
  users afterwards.

### Vehicles and admin verification

`src/modules/vehicles/` (+ `GET/PATCH /api/admin/vehicles…`). A driver registers
`Vehicle`s (plate normalised; `plateKey` is the unique handle, NULL when
REJECTED so a rejected/squatted plate frees up), uploads an `RC` and `LICENCE`
`VehicleDocument` (multipart, JPEG/PNG/PDF by magic bytes, ≤ 5 MB), and an admin
approves/rejects. A ride is posted with a `vehicleId`; `createRide`/`editRide`
check inside their transaction that it is the caller's and `APPROVED`, set the
ride's seats to the vehicle's `seatCapacity` (the seat count is **fixed by the
vehicle**: a client-sent `totalSeats` is optional and must equal it, else 400;
`seatsFor()` in `rides.service.ts`; switching vehicle on edit switches the
seats), then write a `RideVehicle` snapshot. Only a ride with no vehicle — the
verification flag off, i.e. the test suite — still takes `totalSeats` from the
caller. On edit the seats are written *after* the vehicle check so the lock
order stays Ride -> Vehicle.

**Fare check.** `estimatedCost` is the *total* trip cost (split among confirmed
riders) and must be plausible for the route: ₹1–₹10 per km of straight-line
distance (haversine), never below ₹10 or above ₹50,000, a short hop up to ₹200
(`src/lib/fare.ts`, enforced in `createRideSchema` on create and edit; the 400
names the allowed range). `web/src/lib/fare.ts` repeats the numbers to show the
suggested range in the forms (`FareHint`) — the two packages share no imports, so
change both. The seed script's fares all sit inside the band.

- **The snapshot is a separate table on purpose.** `searchRides`, `getMyRides`
  and the admin rides list call `ride.findMany` with no `select`, so any column
  on `Ride` would leak to every searcher and into the Redis cache. Nothing may
  `include: { vehicle }` in a query feeding `GET /api/rides/search`. Riders see
  the vehicle only via `GET /api/bookings/mine` for `CONFIRMED` bookings.
- **Lock order is Ride → Vehicle.** Every write to an existing vehicle
  (`lockVehicle`; `createVehicle` has nothing to lock) takes
  `SELECT … FOR UPDATE` on the vehicle row first, then reads status; vehicle
  writes never lock a Ride or Booking, so no cycle with the Ride → Booking order.
  `createRide` takes the vehicle lock before inserting its new Ride, which
  cannot form a cycle.
- **The review request is pinned to what the admin saw.** The queue returns a
  `reviewVersion` per vehicle (hash of make/model/plate/capacity + each
  document's type and upload time); `PATCH …/review` must echo it and it is
  recomputed under the lock, a mismatch being a 409. This closes approving a
  vehicle whose capacity/plate/documents changed after the admin looked.
- **Edits reset approval:** changing make/model/plate/capacity on an APPROVED
  vehicle, replacing a document on it, or touching a REJECTED one puts it back
  to PENDING. Colour doesn't. Already-posted rides keep their snapshot.
- **`REQUIRE_APPROVED_VEHICLE`** (default on) gates the requirement; only
  `vitest.config.ts` sets it `false`, so the existing integration suite — which
  posts rides without a vehicle — passes untouched. Never set it false in
  production (the server logs a warning if it is). The verification-on path has
  no automated tests (explicit decision, like Bookings).
- **Documents** live in an S3-compatible private bucket via `src/lib/storage.ts`
  (MinIO locally: `docker compose up -d minio`, console :9001). Reached only
  through 60-second signed URLs (`GET /api/vehicles/:id/documents/:type`), each
  issue audit-logged. `S3_ENDPOINT` (app → storage) and `S3_PUBLIC_ENDPOINT`
  (what the browser can reach) differ inside docker. All `S3_*` vars are
  optional: without them the server boots and only the document endpoints 503;
  so does configured-but-unreachable storage (`putObject` maps any storage
  failure to a 503 and logs the cause — a bare 500 on document upload means
  something else). `make dev` starts `minio`; `make down` removes the container
  (the `minio_data` volume, and the uploaded documents, survive).
  The compose `minio` service uses `cgr.dev/chainguard/minio` because
  `minio/minio` is no longer published on Docker Hub.
- Seeded drivers have APPROVED vehicles; Kiran also has a PENDING one for the
  admin queue.
- **Running a second checkout (e.g. a git worktree) next to the main one:**
  `.env`'s `PORT`/`DATABASE_URL` beat the shell because `env.ts` loads dotenv
  with `override: true`. Give it its own database (e.g. `ride_sharing_vv`),
  since the integration suite's `resetDb()` wipes every user.

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
docker compose up -d redis redisinsight  # Redis + its browser UI at localhost:5540 (add a database with host `redis`, port 6379)

npx tsc -p tsconfig.json --noEmit  # type-check without emitting

cd web && npm run dev    # frontend dev server (Vite, localhost:5173)
cd web && npm test        # frontend test suite (Vitest + React Testing Library)
cd web && npm run build   # frontend production build
```

`SMS_DRIVER=console` (the default) means the signup/resend OTP appears in the `npm run dev` terminal output — no SMS account needed locally.

`npm run lint` is defined in package.json but there is no `eslint.config.*` in the repo yet, so it currently fails with "couldn't find configuration file" — set one up before relying on it.

### API docs

`GET /api-docs` serves interactive Swagger UI, generated by `swagger-jsdoc` from `@swagger` JSDoc blocks directly above each route definition in `src/modules/*/*.routes.ts` (config: `src/config/swagger.ts`) — the route files are the single source of truth, not a hand-written spec that could drift from the code. Add/update the JSDoc block whenever a route's shape changes. `helmet`'s default CSP is relaxed only for this one route (`src/app.ts`), since Swagger UI's bundle needs inline scripts/styles that `script-src 'self'` would otherwise block.

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

1. **Authentication** (`requireAuth` in `src/middleware/auth.middleware.ts`) — verifies the JWT read from the `token` httpOnly cookie (not an `Authorization` header — see "Cookie-based auth" below), populates `req.user` (`{ sub, roles, phoneVerified? }`). It also rejects an account whose phone isn't verified with a 403 (see "Phone verification (SMS OTP)"); only `requireAuthAllowUnverified` lets such an account through.
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

### Refresh tokens (short access cookie + rotating refresh cookie)

Design: [2026-10-15-refresh-token-design.md](docs/superpowers/specs/2026-10-15-refresh-token-design.md).
The `token` cookie is now a **15-minute** access JWT (`JWT_EXPIRES_IN`); a second
httpOnly cookie, `refresh_token` (opaque 32 random bytes, `REFRESH_TOKEN_EXPIRES_IN`
= 7d), keeps people signed in. Its path is `/api/auth` (not `/api/auth/refresh`)
because `POST /api/auth/logout` must receive it to revoke the row — it is still
never sent to rides/bookings/etc. `clearRefreshCookie` must repeat that path.
Rows live in `RefreshToken` (only the SHA-256 is stored), logic in
`src/modules/auth/refreshToken.service.ts`.

- **`POST /api/auth/refresh`** needs the CSRF header but not `requireAuth` (the
  access cookie is usually expired). Rotation is one conditional `UPDATE … WHERE
  revokedAt IS NULL AND expiresAt > now()` plus the new row in the same
  transaction, so concurrent refreshes with one token have exactly one winner.
  Roles are re-read from the DB, so role changes apply on refresh; so is
  `phoneVerifiedAt`, so the re-signed access token's `phoneVerified` claim comes
  from the DB.
- **Reuse detection.** A token presented again after being *rotated* is either a
  second tab or a replay. Within `REFRESH_REUSE_GRACE_SECONDS` (10) it only gets
  a fresh access cookie (the winning tab's refresh cookie is already in the
  shared jar); later than that, every refresh token of the user is revoked and
  the call is a 401. The grace window is gated on `rotatedAt`, **not**
  `revokedAt` — a token revoked by logout or by a reuse sweep has no `rotatedAt`
  and must never mint cookies (an earlier draft keyed on `revokedAt` and let a
  logged-out token refresh for 10 s).
- Any failed refresh clears both cookies. Login deletes the user's expired rows;
  there is no cleanup job. An issued access JWT cannot be revoked before it
  expires (≤ 15 min).
- **Frontend:** `web/src/lib/api.ts`'s `apiFetch` retries a 401 once after a
  single shared in-flight `POST /api/auth/refresh` (not for login/signup/refresh
  paths); if refresh fails the original 401 surfaces, so callers' not-logged-in
  handling is unchanged.
- No automated tests were written for this flow (explicit decision, like
  Bookings, rate limiting and notifications); it was verified by hand with curl
  against the dev server.

Integration tests use Supertest's `request.agent(app)` (not plain
`request(app)`) wherever a cookie needs to persist across multiple
requests — plain `request(app)` doesn't retain cookies between calls.

CORS (`src/app.ts`) is locked to `env.FRONTEND_ORIGIN` with `credentials:
true`; it must be set to the real deployed frontend's origin in production
(`render.yaml` prompts for it, `sync: false`) or every credentialed
cross-origin request from the actual frontend will silently fail CORS —
the server starts fine either way, since the env var has a dev-only
default, so a missing/wrong value doesn't surface as a startup error. It
also sets `exposedHeaders: ["Retry-After"]` so the browser can read a 429's
wait time.

`docker compose up`'s full-stack `app` service runs with `NODE_ENV:
production` over plain `http://localhost:3000`, which means the
`Secure; SameSite=None` cookie attributes get issued over HTTP — most
browsers tolerate this for `localhost`, but Safari historically does not.

### Rate limiting

`src/middleware/rateLimit.ts` (`express-rate-limit`). Counters live in Redis when
`REDIS_URL` is set (`src/lib/redisRateLimitStore.ts`, keys `rl:<limiter name>:<ip|user>`,
so they're shared across instances and survive restarts/cold starts), otherwise in
the library's default in-memory store — so local dev and the test suite need no
Redis. Every limiter takes a unique `name` (its Redis key namespace). **Fail
open:** `passOnStoreError: true` plus `src/lib/redis.ts`'s `disableOfflineQueue`
mean a Redis outage makes the limiter throw instantly (~3ms) and the request
passes unlimited, instead of hanging or 5xx-ing — the API stays up, but login
brute-force protection is off until Redis returns (one throttled warning per
30s is logged). The store is hand-written (one Lua `INCR`+`PEXPIRE` script)
rather than the `rate-limit-redis` package, because that package loads its
scripts in `init()` and every request awaits that load: with Redis down at
boot, requests would hang or limiting would be disabled permanently.
`globalLimiter` is mounted in `src/app.ts` after `cors`: per-IP, defaults
300 requests / 15 min (`RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`), `/health` and
`/api-docs` exempt. There is a second **default, per user, for every
authenticated write** (anything but GET/HEAD/OPTIONS): `writeLimiter`, 20 per
minute, mounted once per router right after `requireAuth` (rides, bookings,
vehicles, admin) — so a route needs no limiter of its own and a new route is
covered automatically. (The auth router instead mounts it per route — `PATCH /me`
and both verify-phone routes — after `requireAuthAllowUnverified`.) Per-route overrides are built with `createLimiter({
windowMs, max, key })` and added to a route's middleware chain (`loginLimiter`,
`signupLimiter`, `refreshLimiter`, `otpLimiter` (10/min per user, on verify-phone
and its resend), `bookingLimiter`, `searchLimiter`, `uploadLimiter`). A request
matching several is counted by each, so a route override can only *tighten* a
default; to make a route looser, exempt it in that default's `skip`
(`globalLimiter` or `writeLimiter`). `key: "user"`
keys by JWT subject and only works on routes mounted after `requireAuth`.
`app.set("trust proxy", 1)` is required behind Render's proxy or every client
shares one IP bucket. The integration suite logs in far more than the login
limit allows, so `vitest.config.ts` sets `RATE_LIMIT_ENABLED=false` — it does
*not* rely on `NODE_ENV=test`, because `.env` sets `NODE_ENV=development` and
`env.ts`'s `dotenv.config({ override: true })` clobbers Vitest's value. 429s go through `TooManyRequestsError` and
`errorHandler`; `Retry-After` is set by the library. No automated tests were
written for this module (explicit decision, like Bookings).

### Email notifications (outbox → RabbitMQ → Nodemailer)

`src/modules/notifications/`. `bookSeat`, `cancelBooking` and `transitionRide`
call `notify.ts`, which writes `OutboxEvent` rows via `src/lib/outbox.ts`'s
`enqueueEmail` **inside the same transaction** as the change (same rule as
`writeAuditLog`) — an email is queued iff the change committed. One row = one
fully addressed email with its template variables snapshotted, so the consumer
needs no domain data. A relay (`relay.ts`) polls unpublished rows every 2s
(`FOR UPDATE SKIP LOCKED`, safe across instances) and publishes them to the
`notifications` exchange; the consumer (`consumer.ts`) renders
(`templates.ts`) and sends (`mailer.ts`). Delivery is at-least-once: the
consumer dedupes on `OutboxEvent.sentAt`. Failures: transient SMTP errors go
to `email.retry` (30s TTL, dead-letters back to `email.send`), max 5 attempts;
permanent ones (5xx reply, unknown template, bad payload) and exhausted
retries land in `email.dead`, which nothing consumes — inspect it in the
RabbitMQ UI. Connection loss is handled by amqplib's `recovery` option
(`broker.ts`); the web server boots and serves even if RabbitMQ is down, and
the outbox just accumulates.

- **Emails sent:** booking created (rider + driver), booking cancelled (the
  *other* party), ride cancelled / completed (every `CONFIRMED` rider). There
  is no "ride edited" email because `editRide` refuses rides with confirmed
  bookings. Name/phone appear only for the other party of a `CONFIRMED`
  booking; every email goes only to the user's own address.
- **Where the worker runs:** `RUN_WORKER_IN_PROCESS=true` (default) starts
  relay + consumer inside the web process — needed on Render's free plan
  (no free background worker). `docker-compose.yml` instead sets it `false`
  on `app` and runs `node dist/worker.js` (`src/worker.ts`) as a `worker`
  service. Same code either way.
- **Local dev:** `docker compose up -d db rabbitmq mailpit`; read sent mail at
  http://localhost:8025 (Mailpit keeps mail in memory only — restarting it
  clears the inbox), RabbitMQ UI at http://localhost:15672 (guest/guest).
  `vitest.config.ts` sets `NOTIFICATIONS_ENABLED=false` (and
  `RATE_LIMIT_ENABLED=false`) explicitly, so the integration suite never
  writes outbox rows or needs RabbitMQ.
- **Free production stack:** CloudAMQP "Little Lemur" for `AMQP_URL`, Brevo
  (300 emails/day) or Gmail + app password for `SMTP_*`. Render free
  instances sleep when idle; pending outbox rows go out when the app wakes.
- No automated tests were written for this module (explicit decision, like
  Bookings and rate limiting).
- Footgun: `tsx watch` (`npm run dev`) restarts the relay on every file save;
  harmless because unpublished rows are simply picked up again.

### Search cache (Redis, generation-counter invalidation)

`GET /api/rides/search` is cached in Redis (`src/lib/searchCache.ts`, wired in
`rides.service.ts`'s `searchRides`). Cache keys are
`search:<generation>:<sha256 of the exact query params>`; the generation is the
integer at Redis key `search:gen`. Every write that can change a search result
— `createRide`, `editRide`, `cancelRide`, `completeRide`, `bookSeat`,
`cancelBooking` — runs through `invalidateSearchCacheAfter(...)` and `INCR`s the
generation **after its transaction commits** (never inside it), which makes every
cached entry unreachable at once. A counter instead of deleting keys is
deliberate: with deletion, a reader that fetched old data before the commit can
store it after the delete and leave a stale entry; here the reader reads the
generation *before* querying Postgres and stores under that generation's key, so
a late store lands on a key nobody reads again. Entries have a 60s TTL (reclaims
old generations; also bounds staleness if an `INCR` ever fails). It is optional
and fail-open like the rate limiter: no `REDIS_URL` or any Redis error → straight
to Postgres. It is a read cache only — `bookSeat`'s row-locked `UPDATE` still
decides seat availability, so a stale entry can never cause an overbooking.

- **Adding a new write path** that touches `Ride.status`, `seatsAvailable`,
  route, time or cost (or inserts a ride) must call
  `invalidateSearchCacheAfter`/`invalidateSearchCache`, or search will serve
  stale results for up to 60s. Bookings and ride writes done directly through
  Prisma (seed scripts, admin SQL) bypass it for the same reason. Vehicle writes
  don't change search results, so they don't call `invalidateSearchCache`.
- Tradeoff: one global generation means any booking/ride change invalidates
  every cached search. Fine at POC traffic; the scale path is a generation per
  region.
- Cached hits go through JSON, so `Date`/`Decimal` fields come back as strings —
  identical to what `res.json()` sends, which is the only consumer.

### Ride timing rules and the expiry job

Rules live in `src/lib/rideTime.ts` (IST is a fixed UTC+5:30, no DST, rides are
India-only) and are enforced in the service layer, returning 409:
- **Cancel** a ride (`transitionRide`) or a booking (`cancelBooking`, rider *and*
  driver) is blocked from 00:00 IST on the ride's departure date onward.
- **Complete** a ride is blocked until `departureTime` has passed.
- **Book** a seat (`bookSeat`) is blocked once the ride has departed.
- Side effect to know about: a driver who can't make it on the day has no way
  to cancel; a ride with confirmed riders is then auto-completed.

`rides.service.ts`'s `closeExpiredRides` (run every 5 min, and once at startup,
by `rides/rideExpiry.job.ts`) closes SCHEDULED rides that departed more than
`AUTO_COMPLETE_AFTER_HOURS` (default 12) ago: with confirmed bookings →
COMPLETED (riders get the completion email, audit reason `AUTO_COMPLETED`);
with none → CANCELLED (audit reason `EXPIRED_NO_BOOKINGS`, no email). Audit
actor is `"system"`. It takes each ride's row lock with `FOR UPDATE SKIP LOCKED`
and re-checks the conditions under it, so several instances (or a driver acting
at the same moment) can't double-process a ride; it's time-based, not a
per-ride timer, so it catches up after downtime. The job is started by
`src/background.ts` (shared with the notifications worker): inside the web
process when `RUN_WORKER_IN_PROCESS=true`, or by `worker.ts`.
- The frontend does not yet mirror these rules (buttons are not disabled
  before they're allowed) — the API just returns the 409 message.
- `tests/integration/rides.test.ts`'s "completes the driver's own scheduled
  ride" test predates the departure rule (its ride departs in 2027); it needs
  the ride's `departureTime` moved into the past to pass.

### Money and matching — two non-obvious data rules from the design spec

- **Money is always `Decimal`, never `Float`**, end-to-end: `estimatedCost` is validated in `rides.schemas.ts` as a regex-checked *string* (`/^\d+(\.\d{1,2})?$/`), not coerced to a JS number, so it never passes through float arithmetic before reaching Prisma's `@db.Decimal(10, 2)` column.
- **Matching is a real indexed query, not an in-memory filter.** `rides.service.ts`'s `searchRides` converts a search radius (km) into a lat/lng bounding box (`KM_PER_DEGREE_LAT = 111`, longitude delta scaled by `cos(latitude)`) and ANDs it with an indexed `departureTime` range — see the `@@index` declarations on `Ride` in `prisma/schema.prisma`. The design doc's §4 documents the PostGIS (`ST_DWithin` + GiST index) upgrade path for when bounding-box approximation stops being good enough; that migration is additive, not a redesign.
- The last-seat booking concurrency guarantee (design spec §5) is implemented, via the `Booking` model in `prisma/schema.prisma` — see "Bookings and the audit trail" below for how.
- **Rides are India-only.** `LocationPicker.tsx` sends `countrycodes=in` to Nominatim (exact), and `createRideSchema` / `searchRidesQuerySchema` reject coordinates outside `src/lib/indiaBounds.ts`'s bounding box with a 400 on `originLat`/`destLat`. The box is a coarse approximation (it admits slivers of neighbouring countries); a polygon check is the upgrade path. `createRideSchema` is shared by `POST /api/rides` and `PATCH /api/rides/:id`, so editing can't move a ride abroad.
- **The search date is optional.** `earliestDeparture`/`latestDeparture` are each optional on `GET /api/rides/search`; with neither, it is a route-only search over every upcoming ride. `findMatchingRides` always clamps the lower bound to "now" (a ride stays `SCHEDULED` for hours after leaving but can't be booked, so departed rides are never listed) and returns at most 100 rides, soonest first. `SearchRidesPage.tsx` takes one optional calendar date and, when set, expands it into the full local day (`${date}T00:00:00` → `${date}T23:59:59.999`); empty means it sends no date params. The cache key uses `""` for a missing bound, so route-only and dated searches never share an entry.
- **Origin/destination are picked by name, not typed as raw lat/lng.** `web/src/components/LocationPicker.tsx` is a debounced (~400ms) autocomplete against OpenStreetMap's Nominatim (`nominatim.openstreetmap.org`, called directly from the browser — no API key, no signup, free). Selecting a result fills the same lat/lng/label values the form always submitted; nothing on the backend changed. Chosen over Google Maps Places specifically because Google requires a billing account (credit card) to enable any Maps Platform API, which is unnecessary friction for this POC.

### Bookings and the audit trail

`src/modules/bookings/`'s `bookSeat`, `cancelBooking`, and
`rides.service.ts`'s `transitionRide` and `editRide` are the four places in
this codebase where a genuine race condition is possible, and all four
handle it the same way: a conditional `updateMany` that re-checks a
precondition under the same row lock that performs the write, rather than
trusting an earlier unlocked read. `bookSeat`'s version is `UPDATE "Ride" SET
"seatsAvailable" = "seatsAvailable" - 1 WHERE id = ? AND status = 'SCHEDULED'
AND "seatsAvailable" > 0`, inside the same transaction as the `Booking`
insert. Postgres's row lock on that `UPDATE` is what makes two concurrent
requests for the last seat resolve to exactly one winner — there is no
explicit `SELECT ... FOR UPDATE` or app-level mutex anywhere in this path,
and there doesn't need to be. `editRide` uses the same conditional
`updateMany` (preconditioned on `status = 'SCHEDULED'`) to take the Ride
row lock *before* checking for `CONFIRMED` bookings — a confirmed booking
found after that check throws, which rolls back the whole transaction
including the tentative field update, so a concurrent `bookSeat` can't slip
a new booking in between the check and the write. All four functions that
touch both a `Ride` and its `Booking`s take their locks in the same order —
`Ride` first, then `Booking` — to avoid a cross-transaction deadlock from
opposite lock ordering. See
[2026-10-09-booking-module-design.md](docs/superpowers/specs/2026-10-09-booking-module-design.md)
§5 for the two alternative approaches considered and why they weren't chosen.

`Booking.costShare` is recalculated — for every `CONFIRMED` booking on a
ride, not just the one that changed — inside the same transaction as any
booking creation or cancellation, via `bookings.service.ts`'s
`recalculateShares`. Driver/rider contact info (`name`, `phone`) is returned
only alongside a `CONFIRMED` booking, only from `GET /api/bookings/mine` and
`GET /api/rides/:id/bookings` — `GET /api/rides/search` never selects
contact fields at all, so "excluded during search" is enforced at the query,
not by filtering a response afterward.
One deliberate exception: `GET /api/rides/:id/bookings` (driver only) also
returns `riderName` and `cancelledAt` for *cancelled* bookings, so the driver can
see who cancelled and when — e.g. the same rider who then booked again — instead
of an anonymous row. The phone (`riderContact`) is still CONFIRMED-only.

Every state-changing operation (ride created/cancelled/completed, booking
created/cancelled, cost recalculated) writes one `AuditLog` row
(`src/lib/auditLog.ts`'s `writeAuditLog`) inside the same transaction as the
change itself — never as a separate, unguarded write that could drift out of
sync with what actually happened.

### Testing

- **Running the integration suite empties the dev database** (`resetDb()` wipes every
  user/ride/booking in the same `ride_sharing` DB `npm run dev` uses). Re-seed with
  `npm run db:seed` afterwards.
- Integration tests (`tests/integration/*.test.ts`) hit a **real** Postgres via Supertest against the actual `app` — no mocking the database. Unit tests (`tests/unit/*.test.ts`) must never touch it.
- `vitest.config.ts` sets `fileParallelism: false` because all integration test files share one database. Each integration file must clean up via the shared `resetDb()` helper in `tests/integration/testDb.ts`, which deletes rows in FK-safe order (children before parents) — extend that helper, not each test file's own `beforeEach`, whenever a new table gets a foreign key, or you'll get a cross-suite foreign-key-violation failure that only reproduces when the full suite runs in a particular order.
- This codebase follows strict TDD: a failing test is written and run first, then the minimal implementation, then refactor. Follow the same discipline for new endpoints.
- Exception: the Booking module deliberately skips this discipline — no automated tests were written for it beyond the one required concurrency test in `bookSeat`. This was a scoped, explicit decision for this module, not an oversight; see the Global Constraints section of [2026-10-09-booking-module.md](docs/superpowers/plans/2026-10-09-booking-module.md) for the reasoning.
- Exception: vehicle verification adds no automated tests (see "Vehicles and admin verification"); `tests/integration/testDb.ts` needs no change because `resetDb()` deletes rides before users — `RideVehicle.ride`, `Vehicle.owner` and `VehicleDocument.vehicle` cascade, while `RideVehicle.vehicle` is RESTRICT (safe only because rides go first).
- Exception: phone verification adds no automated tests (explicit decision, like Bookings and refresh tokens); it was verified by hand with the `console` SMS driver. The existing signup/login tests keep passing because `vitest.config.ts` sets `REQUIRE_PHONE_VERIFICATION=false` (no gate, no SMS), exactly like `REQUIRE_APPROVED_VEHICLE`.
