# Booking Module — Design Spec

**Status:** Approved for implementation
**Builds on:** [2026-09-26-ride-sharing-matching-design.md](2026-09-26-ride-sharing-matching-design.md), [2026-10-08-frontend-cookie-auth-design.md](2026-10-08-frontend-cookie-auth-design.md)
**Assignment reference:** `Anjali-ride-sharing-and-matching.md` §3.3–§3.7, §4, §6, §7

## 1. Problem

A gap check against the original assignment found that everything *around* booking is
built — auth, ride posting, indexed proximity+time search, ride cancel/complete with
ownership checks and locking — but the booking system itself, which the assignment
explicitly names as the POC's "centre of gravity," does not exist. There is no `Booking`
model, no way to reserve a seat, no seat-count concurrency guarantee, no cost split, no
contact-reveal-on-match, and no structured audit trail.

This spec covers exactly that gap: §3.3 (booking a seat, race-safe), §3.4 (cancellation),
§3.5 (cost splitting), §3.7 (contact visibility), plus the audit trail required by §6 and
the matching UI needed on the frontend. It does not revisit search/matching, ride posting,
or auth — those are done and this spec builds on top of them unchanged.

## 2. Scope

**In scope:**
- Backend: `Booking` and `AuditLog` Prisma models; `POST /api/rides/:id/bookings`
  (race-safe), `GET /api/bookings/mine`, `PATCH /api/bookings/:id/cancel`,
  `GET /api/rides/:id/bookings`; cascading cancellation from ride-cancel; cost-split
  recalculation; audit log writes on every state change.
- Frontend: a "Book" action on search results, a new "My bookings" page for riders, and
  an extension of the existing "My rides" page so drivers see confirmed riders per ride.

**Out of scope (explicitly, per the assignment's own §8 framing — "don't add new
features, deepen what's here"):**
- Load-testing the matching query at 10,000 open rides.
- Partial-route matching (joining partway along a route).
- Multi-instance concurrent-booking simulation beyond the in-process concurrent test
  this spec already requires.
- Multi-seat bookings (one booking = one seat, confirmed in brainstorming — a rider
  wanting 3 seats makes 3 separate bookings).
- A driver-approval step before a booking confirms. The assignment describes booking as
  immediate ("a rider books a seat on a matched ride"); there is no `PENDING` status.

## 3. Data model

```prisma
model Booking {
  id          String        @id @default(uuid())
  rideId      String
  ride        Ride          @relation(fields: [rideId], references: [id])
  riderId     String
  rider       User          @relation(fields: [riderId], references: [id])
  status      BookingStatus @default(CONFIRMED)
  costShare   Decimal       @db.Decimal(10, 2)
  createdAt   DateTime      @default(now())
  cancelledAt DateTime?

  @@index([rideId])
  @@index([riderId])
}

enum BookingStatus {
  CONFIRMED
  CANCELLED
}

model AuditLog {
  id         String   @id @default(uuid())
  entityType String   // "Ride" | "Booking"
  entityId   String
  action     String   // "CREATED" | "CANCELLED" | "COMPLETED" | "COST_RECALCULATED"
  actorId    String
  metadata   Json?
  createdAt  DateTime @default(now())

  @@index([entityType, entityId])
}
```

`Ride` gains a `bookings Booking[]` back-relation; `User` gains a `bookings Booking[]`
back-relation (as rider). No changes to existing `Ride`/`User` fields.

## 4. Booking lifecycle and endpoints

| Endpoint | Access | Behavior |
|---|---|---|
| `POST /api/rides/:id/bookings` | `RIDER` | Atomically reserves one seat (§5) and creates a `CONFIRMED` booking, or fails with `409` if no seats remain or the ride isn't `SCHEDULED`. Recalculates cost shares (§6) for the ride's confirmed bookings. |
| `GET /api/bookings/mine` | `RIDER` | The caller's own bookings, any status, newest first. Includes the ride's driver contact info (§7) only for `CONFIRMED` entries. |
| `PATCH /api/bookings/:id/cancel` | `RIDER` (own booking) or `DRIVER` (ride's owner) | Ownership check allows either party. Returns the seat to `seatsAvailable`, flips status to `CANCELLED`, sets `cancelledAt`, recalculates cost shares for the ride's remaining confirmed bookings. `404` if the booking doesn't exist, `403` if the caller is neither the rider nor the ride's driver, `409` if already cancelled. |
| `GET /api/rides/:id/bookings` | `DRIVER` (ride's owner) | Lists bookings for one ride, with rider contact info (§7) for `CONFIRMED` entries. `403` for a driver who doesn't own the ride. |

**Cascading cancellation:** the existing `PATCH /api/rides/:id/cancel` (ride-level cancel,
already built) is extended: in the same transaction that flips the ride to `CANCELLED`,
every `CONFIRMED` booking on that ride flips to `CANCELLED` too, with `seatsAvailable`
left as-is (the ride is gone regardless) and one `COST_RECALCULATED`-adjacent audit entry
noting the cascade. A rider whose booking was cascade-cancelled sees it as `CANCELLED` in
`GET /api/bookings/mine` — no separate "the ride was pulled" messaging; the ride itself
being `CANCELLED` is the explanation.

## 5. Race-safe seat booking

**Chosen approach: a conditional atomic `UPDATE`, inside a transaction with the booking
insert.**

```ts
export async function bookSeat(rideId: string, riderId: string) {
  return prisma.$transaction(async (tx) => {
    const ride = await tx.ride.findUnique({ where: { id: rideId } });
    if (!ride || ride.status !== "SCHEDULED") {
      throw new ConflictError("This ride is not open for booking");
    }

    const result = await tx.ride.updateMany({
      where: { id: rideId, seatsAvailable: { gt: 0 } },
      data: { seatsAvailable: { decrement: 1 } },
    });
    if (result.count === 0) {
      throw new ConflictError("No seats available");
    }

    const confirmedCount = (await tx.booking.count({ where: { rideId, status: "CONFIRMED" } })) + 1;
    const share = computeShare(ride.estimatedCost, confirmedCount);

    const booking = await tx.booking.create({
      data: { rideId, riderId, status: "CONFIRMED", costShare: share },
    });

    await recalculateShares(tx, rideId, confirmedCount, share); // updates OTHER confirmed bookings' shares
    await writeAuditLog(tx, "Booking", booking.id, "CREATED", riderId, { rideId });

    return booking;
  });
}
```

**Why this is race-safe:** `updateMany` with `WHERE seatsAvailable > 0` is a single SQL
statement. Postgres takes a row-level lock on the `Ride` row for the duration of the
`UPDATE`, so two concurrent transactions targeting the same ride serialize at the
database level — the second one's `UPDATE` physically cannot run until the first
transaction commits or rolls back. By the time the second one runs, if the first
succeeded, `seatsAvailable` is already `0`, so the second `UPDATE`'s `WHERE` clause
matches zero rows, `result.count` is `0`, and it throws — never reaching the `INSERT`.
Exactly one booking is created for the last seat, with no explicit lock statement needed;
the `UPDATE`'s own row lock *is* the lock.

**Alternatives considered (for the walkthrough):**
- **`SELECT ... FOR UPDATE`:** equivalent correctness — explicitly lock the row, check
  `seatsAvailable` in application code, then `UPDATE` + `INSERT`. One extra round-trip
  versus the conditional `UPDATE`, and the correctness is implicit in the SQL rather than
  stated as a separate lock step. Not chosen because it adds a step without adding
  safety.
- **`SERIALIZABLE` isolation + retry:** the strongest guarantee, and the natural choice
  if the operation touched many unrelated tables where a single atomic `UPDATE` wouldn't
  capture the invariant. Not chosen here because the invariant ("don't oversell this one
  counter") is exactly what a conditional `UPDATE` is built for, and `SERIALIZABLE` adds
  retry-loop machinery and occasional spurious aborts this POC doesn't need.

## 6. Cost splitting

`Booking.costShare` = `Ride.estimatedCost` ÷ (count of `CONFIRMED` bookings on that
ride), rounded to 2 decimal places. Recalculated transactionally whenever the confirmed
count changes:
- A new booking lands → every existing confirmed booking's share is recomputed and
  updated, then the new booking is created with the same recomputed share.
- A booking cancels → every remaining confirmed booking's share is recomputed and
  updated.

**Known simplification:** dividing a `Decimal` cost by a count that doesn't divide it
evenly (e.g., ₹1000 ÷ 3) leaves a rounding remainder across riders' shares that doesn't
sum back to exactly the original total to the last paisa. This is called out here rather
than silently accepted — a real system would assign the remainder to one rider by a
documented rule; this POC rounds each share independently and accepts the small
discrepancy, since the assignment's checked criteria are about the *recalculation
happening correctly*, not cent-perfect reconciliation.

## 7. Contact visibility

Unchanged from today almost everywhere: `GET /api/rides/search` never selects driver
contact fields — exclusion happens *at the query*, not by filtering a response after the
fact. The only two places contact info is ever returned:

- `GET /api/bookings/mine` (rider) — the ride's driver `name`/`phone`, included only when
  that specific booking's `status === "CONFIRMED"`.
- `GET /api/rides/:id/bookings` (driver) — each booking's rider `name`/`phone`, same
  `CONFIRMED`-only rule.

This directly answers the assignment's walkthrough question 2: *excluded at the query*
for search; *conditionally included*, gated on confirmed-booking status, in the two
booking-scoped endpoints — never exposed anywhere else.

## 8. Audit trail

Every state-changing operation writes one `AuditLog` row inside the same transaction as
the change it records:

| Event | `entityType` | `action` | `metadata` |
|---|---|---|---|
| Ride posted | `Ride` | `CREATED` | — |
| Ride cancelled (cascades bookings) | `Ride` | `CANCELLED` | `{ cascadedBookingIds: [...] }` |
| Ride completed | `Ride` | `COMPLETED` | — |
| Booking created | `Booking` | `CREATED` | `{ rideId }` |
| Booking cancelled | `Booking` | `CANCELLED` | `{ rideId }` |
| Cost shares recalculated | `Ride` | `COST_RECALCULATED` | `{ shares: [{ bookingId, costShare }, ...] }` |

One row per event, not one row per affected rider — a recalculation touching 4 bookings
is one `AuditLog` entry listing all 4 new shares in `metadata`, giving a single piece of
dispute evidence ("here's exactly what changed and why") rather than a flood of rows.

## 9. Frontend changes (`web/`)

- **`SearchRidesPage`**: each result gets a "Book" button, visible to riders. On success,
  shows a confirmation and the assigned cost share; on `409` (no seats / ride no longer
  open), shows the server's message inline — the existing `apiFetch`/`ApiError` pattern,
  no new error-handling mechanism.
- **New `MyBookingsPage`** (`/bookings/mine`, rider-only nav link): lists the rider's
  bookings (route, time, status, cost share), with driver contact shown only for
  `CONFIRMED` entries, and a cancel action per `CONFIRMED` booking — same action/refetch
  pattern as `MyRidesPage`'s existing cancel button.
- **`MyRidesPage`** (driver): each `SCHEDULED`/`COMPLETED` ride's card gains a small list
  of its confirmed bookings (rider name, phone, cost share), fetched from
  `GET /api/rides/:id/bookings`.
- **Nav (`Layout.tsx`)**: a "My bookings" link, gated on the `RIDER` role, alongside the
  existing `DRIVER`-gated links.

## 10. Testing

**Explicit scope decision (overrides this codebase's usual TDD-everywhere discipline for
this module only):** this is a POC, and the user asked to skip test-writing and TDD
process generally for this work. The one exception is the test the assignment names
directly as a graded criterion — everything else in this module is built directly and
verified manually (browser + manual API calls), the same way the recent role-selection
and geolocation work was verified this session, not through automated tests.

**The last-seat concurrency test — written, because the assignment explicitly requires
it (§6):** a ride with `seatsAvailable: 1`, two `request.agent(app)` riders, firing
`POST /bookings` via `Promise.all` at the same time. Asserts: exactly one response is
`201`, exactly one is `409`; `Ride.seatsAvailable` is `0` afterward; exactly one
`Booking` row exists for that ride. This exercises the real Postgres container through
two genuinely concurrent in-flight requests — not two sequential calls that happen to
look fine, which is exactly what the assignment calls out as the thing to get right, and
what the walkthrough (§7) expects to be shown.

**Not automated, verified manually instead:** IDOR (rider can't cancel another rider's
booking; driver can't list another driver's ride's bookings), the cascade-cancel-on-
ride-cancel behavior, cost-recalculation correctness, the contact-visibility rules, and
bad-input rejection (booking a non-`SCHEDULED` ride, booking with zero seats left) — all
exercised by hand via the browser/API once built, not pinned by a test suite.

## 11. Delivery order

1. Backend: `Booking`/`AuditLog` models + migration, `bookSeat` plus its concurrency test
   (§10 — the one test this module writes), `GET /bookings/mine`,
   `PATCH /bookings/:id/cancel`, `GET /rides/:id/bookings`, cascading cancel on the
   existing ride-cancel, audit log writes — built directly and verified manually, not
   test-first.
2. Frontend: "Book" button on search, `MyBookingsPage`, `MyRidesPage`'s booking list,
   nav link — verified manually via the browser.
