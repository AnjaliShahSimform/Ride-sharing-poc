# Ride Sharing and Matching — Design Spec

**Status:** Approved for implementation
**Track:** React to Full Stack — 101 POC (Simform)
**Stack:** Express + TypeScript + PostgreSQL + Prisma

## 1. Problem

Drivers post a scheduled ride (route + departure time + seats). Riders search for
rides that roughly match their intended route and time, and book a seat. Two hard
requirements drive every design decision here:

1. Matching must be a real, indexable database query — proximity of both origin
   and destination together with time-window overlap — not an in-memory filter
   over all rides.
2. Booking the last seat must be race-safe: two concurrent requests for the same
   last seat must not both succeed.

This is closer to a scheduled-carpool product (BlaBlaCar-style) than to Uber/Ola's
real-time dispatch: no live GPS tracking, no dispatch algorithm, no surge pricing.
Those are explicitly out of scope for now (see §7).

## 2. Actors & Authorization

Any user can act as both driver and rider — not modeled as two separate account
types. Instead:

- `Role` enum: `DRIVER`, `RIDER`, `ADMIN`. `User.roles: Role[]`. Every signup gets
  `[DRIVER, RIDER]`.
- **RBAC middleware** (`requireRole('DRIVER')`) gates which *routes* an account can
  call.
- **Resource-level ownership checks** in the service layer gate which *records* an
  account can act on (a driver can cancel only their own ride; a rider only their
  own booking) — this is what the IDOR test in the POC rubric (§6) is checking.
- `ADMIN` is modeled now but not wired to any route yet — reserved for a future
  moderation/dispute view over `AuditLog` (§7).

## 3. Data model

```prisma
enum Role          { DRIVER RIDER ADMIN }
enum RideStatus    { SCHEDULED COMPLETED CANCELLED }
enum BookingStatus { CONFIRMED CANCELLED }

model User {
  id           String   @id @default(uuid())
  name         String
  email        String   @unique
  phone        String
  passwordHash String
  roles        Role[]
  ridesAsDriver Ride[]
  bookings     Booking[]
  createdAt    DateTime @default(now())
}

model Ride {
  id             String   @id @default(uuid())
  driverId       String
  driver         User     @relation(fields: [driverId], references: [id])
  originLat      Float
  originLng      Float
  destLat        Float
  destLng        Float
  originLabel    String
  destLabel      String
  departureTime  DateTime
  totalSeats     Int
  seatsAvailable Int
  estimatedCost  Decimal  @db.Decimal(10, 2)
  status         RideStatus @default(SCHEDULED)
  bookings       Booking[]
  createdAt      DateTime @default(now())

  @@index([departureTime])
  @@index([originLat, originLng])
  @@index([destLat, destLng])
}

model Booking {
  id          String   @id @default(uuid())
  rideId      String
  ride        Ride     @relation(fields: [rideId], references: [id])
  riderId     String
  rider       User     @relation(fields: [riderId], references: [id])
  status      BookingStatus @default(CONFIRMED)
  costShare   Decimal  @db.Decimal(10, 2)
  createdAt   DateTime @default(now())
  cancelledAt DateTime?

  @@unique([rideId, riderId, status])
}

model AuditLog {
  id         String   @id @default(uuid())
  actorId    String
  action     String
  entityType String
  entityId   String
  before     Json?
  after      Json?
  createdAt  DateTime @default(now())
}
```

Money is always `Decimal`, never `Float` (durable mistake per company 201 path
§1.12).

## 4. Matching query

Represent origin/destination as plain `lat`/`lng` float columns (Option B from
design discussion). Search filters with a bounding box (search radius converted to
a degree delta) on both origin and destination pairs, `AND`ed with an indexed
`departureTime BETWEEN earliest AND latest`. Expressed entirely through Prisma's
type-safe query builder — no raw SQL needed for the POC.

Indexes: `(originLat, originLng)`, `(destLat, destLng)`, `(departureTime)` — all
declared in §3. This turns the query into an index range scan instead of a
sequential scan; verified with `EXPLAIN ANALYZE` under a 10,000-row seed (§8
bonus).

**Scaling this query (documented now, not built now):** once bounding-box
approximation or query volume becomes a real constraint, migrate to PostGIS
(`geography` column + GiST index + `ST_DWithin`), which requires raw SQL via
`$queryRaw` since Prisma doesn't model PostGIS types natively, and the
`postgis/postgis` Docker image in place of plain `postgres`. The lat/lng columns
stay meaningful either way — this is an additive migration, not a redesign.

## 5. Booking concurrency — the last-seat guarantee

A single atomic conditional `UPDATE`, inside a Prisma transaction:

```sql
UPDATE "Ride"
SET "seatsAvailable" = "seatsAvailable" - 1
WHERE id = $1 AND "seatsAvailable" > 0 AND status = 'SCHEDULED'
RETURNING "seatsAvailable";
```

If this affects zero rows, no seat was available (or the ride is no longer
`SCHEDULED`) — return `409` and do not insert a `Booking`. If it affects one row,
insert the `Booking` and recompute `costShare` for all `CONFIRMED` bookings on
that ride, in the same transaction.

**Why this over the alternatives:**
- `SELECT ... FOR UPDATE` + separate `UPDATE`: functionally equivalent, just an
  extra round trip and an extra line a mistake can hide behind.
- Optimistic `version` column: built for detecting *any* concurrent change to a
  row; here we're protecting one counter, so it's unneeded machinery.
- App-level/in-memory locking: actively wrong once there's more than one app
  instance (a stated future goal) — the guarantee has to live in Postgres, the
  one thing every instance already shares.

## 6. API surface

All routes but signup/login require `Authorization: Bearer <jwt>`.

| Method & path | Access | Notes |
|---|---|---|
| `POST /api/auth/signup` | public | roles `[DRIVER, RIDER]`, returns JWT |
| `POST /api/auth/login` | public | returns JWT |
| `POST /api/rides` | `DRIVER` | rejects past `departureTime`, `totalSeats <= 0` |
| `GET /api/rides/search` | authenticated | §4 query; response DTO never selects contact fields |
| `GET /api/rides/:id` | authenticated | contact fields included only for the driver or a rider with a `CONFIRMED` booking |
| `GET /api/rides/mine` | `DRIVER` | own posted rides |
| `PATCH /api/rides/:id/cancel` | `DRIVER` + ownership | cascades: all bookings → `CANCELLED` |
| `PATCH /api/rides/:id/complete` | `DRIVER` + ownership | locks the ride — every mutating check above then returns `409` |
| `POST /api/bookings` | `RIDER` | §5's atomic update; recalculates cost split |
| `GET /api/bookings/mine` | `RIDER` | own bookings; driver contact only while `CONFIRMED` |
| `PATCH /api/bookings/:id/cancel` | booking's rider or ride's driver | seat returned, cost split recalculated |
| `GET /api/rides/:id/audit` | ride's driver or a rider with a booking on it | dispute evidence trail |

Centralized error handler maps typed errors to `400` (validation), `401` (auth),
`403` (role/ownership), `404` (not found), `409` (business-rule conflict).

## 7. Explicitly out of scope for now (documented, not forgotten)

- Live GPS tracking / websocket location streaming — not required by the spec;
  user has confirmed this is deferred, may be added later without a schema
  change (it would be a new table + a real-time channel, additive).
- Admin/moderation UI over `AuditLog` — schema supports it (`ADMIN` role exists),
  no route built yet.
- PostGIS-based matching — documented upgrade path in §4, not needed at current
  scale.
- Partial-route matching (§8 optional bonus) — same matching primitive, deferred
  until the core path is solid.

## 8. Observability & evidence

- Structured logs via Pino (JSON, request-scoped correlation ID) for operational
  visibility.
- `AuditLog` table (not just log lines) for every ride post, booking, cancellation,
  and cost recalculation — logs in a container that gets recreated aren't
  reliable evidence for a billing dispute; a DB row is.
- Integration tests (Vitest + Supertest) against a real Postgres test database,
  not mocks — including the concurrent-booking test required by §6, firing two
  simultaneous requests at the last seat and asserting exactly one `201`.

## 9. Delivery order (module by module)

1. Project scaffold: TypeScript config, Express app skeleton, typed env config,
   Docker Compose (Postgres), Prisma init.
2. **Auth module** — signup/login, bcrypt, JWT issuing + verification middleware,
   RBAC middleware.
3. Rides module — post ride, search/match, cancel, complete.
4. Bookings module — book seat (concurrency-safe), cancel, cost split.
5. Audit log wiring across all mutations + audit read endpoint.
6. Docker Compose end-to-end (`docker compose up` with no manual steps beyond
   `.env`), README with run instructions and technical summary.
