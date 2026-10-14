# Vehicle details and admin verification — design

Date: 2026-10-14
Status: draft, awaiting review

## 1. Goal and scope

A driver registers a vehicle once and links it to every ride they post. A ride
can only be posted with a vehicle an admin has approved. Confirmed riders see
the vehicle. Documents (RC, driving licence) are uploaded by the driver and
reviewed by an admin.

In scope: `Vehicle`, `VehicleDocument` and `RideVehicle` models, vehicle CRUD,
document upload and signed-URL download, an admin review queue, linking a
vehicle to a ride plus the seat-capacity rule, approval/rejection emails, seed
data, and the frontend pages for all of it.

Out of scope (later): document expiry jobs and expiry emails, phone OTP,
government API verification (Parivahan/DigiLocker), ratings, payments,
revoking an already-approved vehicle, OCR, vehicle details inside the
booking-created email.

## 2. Where vehicle data is collected

Not at signup (riders sign up too, and `signupSchema` stays unchanged) and not
re-typed per ride. A separate `Vehicle` entity owned by the driver, created the
first time they want to post a ride. A driver may own any number of vehicles,
each approved independently. The post-ride form picks from the driver's
`APPROVED` vehicles.

## 3. Data model

```prisma
enum VehicleStatus { PENDING APPROVED REJECTED }
enum DocType { RC LICENCE }

model Vehicle {
  id            String        @id @default(uuid())
  ownerId       String
  owner         User          @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  make          String
  model         String
  colour        String
  plateNumber   String                    // normalised, e.g. "MH12AB1234"
  plateKey      String?       @unique     // = plateNumber while PENDING/APPROVED; NULL when REJECTED
  seatCapacity  Int                       // passenger seats, excluding the driver (1..8)
  status        VehicleStatus @default(PENDING)
  rejectionNote String?
  reviewedById  String?
  reviewedAt    DateTime?
  createdAt     DateTime      @default(now())
  documents     VehicleDocument[]
  rideLinks     RideVehicle[]

  @@index([ownerId])
  @@index([status, createdAt])            // admin review queue
}

model VehicleDocument {
  id         String   @id @default(uuid())
  vehicleId  String
  vehicle    Vehicle  @relation(fields: [vehicleId], references: [id], onDelete: Cascade)
  type       DocType
  storageKey String                       // object key, never a public URL
  mimeType   String
  sizeBytes  Int
  uploadedAt DateTime @default(now())

  @@unique([vehicleId, type])             // re-upload replaces
}

// One row per ride posted with a vehicle: an immutable snapshot of what riders
// booked against. Deliberately a separate table, NOT columns on Ride (see §3.2).
model RideVehicle {
  rideId    String   @id
  ride      Ride     @relation(fields: [rideId], references: [id], onDelete: Cascade)
  vehicleId String
  vehicle   Vehicle  @relation(fields: [vehicleId], references: [id])
  make      String
  model     String
  colour    String
  plate     String

  @@index([vehicleId])
}
```

`Ride` gains only the back-relation `vehicle RideVehicle?`. Legacy rides (and
rides created while `REQUIRE_APPROVED_VEHICLE=false`) simply have no row; the UI
shows "vehicle details not provided". No `APPROVED` vehicles are fabricated for
existing drivers.

### 3.1 Rules

- **Plate.** Normalised by one pure function (uppercase, strip spaces/dashes,
  Indian-plate regex) used everywhere. Uniqueness is on `plateKey`, which is set
  while a vehicle is `PENDING`/`APPROVED` and nulled when it is `REJECTED`
  (Postgres allows many NULLs under a unique index). This keeps the constraint
  pure Prisma (no raw partial index, no migrate drift) and means a rejected or
  squatted registration does not lock the real owner out of the plate forever.
  A clash is a 409.
- **Resubmission.** A `REJECTED` vehicle returns to `PENDING` when the driver
  edits it or re-uploads a document; `plateKey` is re-claimed then (409 if
  someone else now holds the plate).
- **Sensitive edits.** Editing make, model, plate or capacity on an `APPROVED`
  vehicle resets it to `PENDING`. Editing colour does not. Re-uploading a
  document on an `APPROVED` vehicle also resets it to `PENDING` (otherwise a
  driver could swap a document after approval).
- **Seat capacity.** Capacity is validated 1..8. A ride requires
  `totalSeats <= seatCapacity`. Changing a vehicle's capacity never touches
  rides already posted.
- **Posting.** `createRide`/`editRide` check inside the service: the vehicle
  belongs to the caller (IDOR), is `APPROVED`, and the seat rule holds, then
  write the `RideVehicle` snapshot in the same transaction.
- **Switching a ride's vehicle.** Allowed through `editRide` only while the ride
  has no `CONFIRMED` bookings (the existing `editRide` rule). Same checks; the
  snapshot row is replaced. Once a booking is confirmed the vehicle is locked;
  the only way out is cancelling, subject to the existing cancellation timing
  rules.
- **Existing rides keep running** if their vehicle later becomes `PENDING` or
  `REJECTED`; only new rides are blocked. Edits to a vehicle never alter an
  existing snapshot.
- **Ownership errors follow the codebase convention:** 404 when the vehicle
  doesn't exist, 403 when it exists but belongs to someone else (same as
  `rides.service.ts`).
- **Roles.** Only users with the `DRIVER` role can create vehicles. A user with
  both `DRIVER` and `ADMIN` roles can't review their own vehicle
  (`reviewedById !== ownerId`, 403).
- **Approval** requires both `RC` and `LICENCE` documents (409 otherwise).
- **Review is final per submission.** Only a `PENDING` vehicle can be reviewed.

### 3.2 Why the snapshot is a separate table

`searchRides` (`findMatchingRides`), `getMyRides` and the admin rides list all
call `prisma.ride.findMany` with **no `select`**, and the search result is also
stored in the Redis cache. Any column added to `Ride` would therefore be
returned to every searcher and cached the moment it was added — including the
plate, before any booking. A separate `RideVehicle` table is excluded by
default: nothing returns it unless a query explicitly `include`s it. Prisma's
`omit` API is still a preview feature on the installed Prisma 5.20, so a
select/omit-based fix is not used.

Visibility, enforced by what each query includes:

| Endpoint | Vehicle visible? |
|---|---|
| `GET /api/rides/search` | never (query unchanged) |
| `GET /api/rides/mine` | yes — own rides (`include: { vehicle: true }`) |
| `GET /api/bookings/mine` | only for `CONFIRMED` bookings; the mapper already builds explicit objects, `vehicle` is `null` for cancelled |
| `GET /api/rides/:id/bookings` | n/a (driver already knows their vehicle) |
| `GET /api/admin/rides` | yes |

### 3.3 Concurrency and lock order

A driver editing a vehicle (sensitive field -> `PENDING`) can race a ride post
or an admin review. Rules:

- `createRide`: inside the transaction, `SELECT ... FOR UPDATE` the vehicle row,
  re-check `status = APPROVED` and capacity under that lock, then insert the
  ride + `RideVehicle`. A concurrent vehicle edit blocks until commit, so a ride
  can't be created against a vehicle that has just left `APPROVED`.
- `editRide`: existing order (Ride lock via conditional `updateMany`, then the
  `CONFIRMED` check), then lock the new vehicle row. Order is **Ride -> Vehicle**.
  Vehicle writes never take a Ride or Booking lock, so no cycle is possible
  with `bookSeat`/`cancelBooking`/`transitionRide`/`closeExpiredRides`.
- Review: takes the vehicle row lock (`SELECT ... FOR UPDATE`) and then checks
  `status = 'PENDING'` under it, so two admins can't both decide one vehicle
  (the second blocks, then gets 409). Every vehicle write uses this same lock.
- Vehicle edit and document upload take the same vehicle row lock before
  reading the current status, so they can't interleave with a review or a ride
  post into an inconsistent state.

`searchRides` results are unchanged by any vehicle operation, so vehicle writes
need no cache invalidation; `createRide`/`editRide` already call
`invalidateSearchCacheAfter`.

## 4. API

New module `src/modules/vehicles/` (routes, controller, service, schemas —
same layout as `rides/`), plus additions to `src/modules/admin/`. Every route
gets a `@swagger` JSDoc block. `createRideSchema`/`editRide` gain `vehicleId`
(required when `REQUIRE_APPROVED_VEHICLE` is on, optional when off — §8).

| Route | Who | What |
|---|---|---|
| `POST /api/vehicles` | DRIVER | Create vehicle (`PENDING`) |
| `GET /api/vehicles/mine` | DRIVER | Own vehicles with status and rejection note |
| `PATCH /api/vehicles/:id` | DRIVER, owner | Edit; sensitive fields reset to `PENDING` |
| `POST /api/vehicles/:id/documents` | DRIVER, owner | Upload RC or LICENCE (multipart: `type` + `file`) |
| `GET /api/vehicles/:id/documents/:type` | owner or ADMIN | Returns `{ url }`, a short-lived signed URL |
| `GET /api/admin/vehicles?status=PENDING` | ADMIN | Review queue, oldest first |
| `PATCH /api/admin/vehicles/:id/review` | ADMIN | `{ decision: APPROVED \| REJECTED, note? }` |

Layers stay distinct: `requireAuth` -> `requireRole` -> ownership in the service.

## 5. Upload and document security

- `multer` memory storage, 5 MB limit, one file per request. Reject a missing
  file and an unknown `:type` with 400.
- File type is decided by magic bytes (JPEG `FFD8FF`, PNG `89504E47`, PDF
  `%PDF-`) — hand-rolled, no dependency. The client `Content-Type` and
  filename are ignored.
- Storage keys are server-generated (`vehicles/<vehicleId>/<type>/<uuid>`);
  nothing user-supplied reaches a path.
- Private bucket. Signed URLs live 60 s, issued only after the owner/admin
  check, with `ResponseContentDisposition: attachment` and a server-chosen
  content type, so an uploaded PDF is downloaded rather than rendered inline in
  the API's origin. Every issue writes an `AuditLog` row (no storage key in the
  metadata).
- **Replace flow.** Upload the new object, then update the row in a transaction,
  then delete the old object best-effort. A failure after upload leaves an
  orphan object, never a row pointing at a missing file. Orphans are accepted at
  POC scale.
- Documents are never included in search or ride responses.
- `vehicleLimiter` and `uploadLimiter` via `createLimiter({ key: "user" })`.
- New mutating routes already sit behind `requireCsrfHeader`; the frontend's
  multipart upload must send `X-Requested-With: XMLHttpRequest` and must not set
  `Content-Type` itself (the browser adds the multipart boundary).
- The plate is shown unmasked to admins: the review is precisely a comparison of
  the declared plate against the RC document. The plate is printed on the car's
  exterior, so it is not secret. The genuinely sensitive items (licence number,
  RC number, document images) are never stored as text and are only reachable
  through the signed document URL.
- A review `note` is length-limited and rendered as plain text by the frontend
  (React escaping), never as HTML.

### 5.1 Storage

`src/lib/storage.ts` wraps an S3 client (`putObject`, `deleteObject`,
`getSignedUrl`). The AWS SDK is only a client library — no AWS account is
needed. Local dev runs **MinIO** in `docker-compose.yml` (next to RabbitMQ and
Mailpit); production points the same code at any free S3-compatible host
(Supabase Storage free tier needs no card; Backblaze B2 / Cloudflare R2 are
alternatives) through env vars only.

- Env: `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`,
  `S3_SECRET_KEY`, `S3_REGION`, all **optional with no required value at boot**,
  in `env.ts`, `.env.example` and `render.yaml`. Inside docker the app reaches
  MinIO at `http://minio:9000` but the browser must open
  `http://localhost:9000`; a signed URL is only valid for the host it was signed
  for, so signing uses `S3_PUBLIC_ENDPOINT`, uploads use `S3_ENDPOINT`.
- Like RabbitMQ, the web server boots and serves without storage configured;
  only the document endpoints return a clear 503 ("document storage is not
  configured"). Tests and `env.test.ts` are therefore unaffected.
- The bucket is created at startup if missing (MinIO) and must stay private.

## 6. Admin review

- Approve/reject runs under the vehicle row lock, together with its `AuditLog`
  row and the outbox email, in one transaction; approval sets `plateKey`, rejection
  nulls it.
- Email to the driver on approval and on rejection (note included), new
  templates in `notifications/templates.ts`. Mail goes only to the owner's own
  address.
- A review is refused with 409 if the vehicle isn't `PENDING` or lacks a
  document, and with 403 if the admin owns the vehicle.

## 7. Seed data

`prisma/seed.ts` must change, otherwise seeded drivers can't post any ride once
verification is on:

- Create one `APPROVED` vehicle (no documents; the seed bypasses the workflow,
  like it already bypasses signup) per seeded driver, and one `PENDING` vehicle
  with documents-less state for the admin queue demo.
- Seeded rides stay vehicle-less (legacy) except a few linked through
  `RideVehicle`, so both UI states are visible.
- The seed's re-run cleanup must delete `RideVehicle` and the seeded drivers'
  vehicles before rides/users, matching its existing booking-then-ride order.

## 8. Testing decision and how existing tests keep passing

**No automated test cases are written or changed** (explicit decision by the
project owner, same category as Bookings, rate limiting and notifications).
Verification is `npx tsc -p tsconfig.json --noEmit`, `cd web && npm run build`,
and manually driving each flow against the local stack, including Swagger.

About 30 existing integration tests post rides to `POST /api/rides` with no
vehicle, so a hard requirement would turn the suite red. To leave every test
file untouched this uses the same mechanism the repo already uses for
`RATE_LIMIT_ENABLED`, `NOTIFICATIONS_ENABLED` and `REDIS_ENABLED`:

- New env flag `REQUIRE_APPROVED_VEHICLE`, **default `true`** (secure by
  default; not exposed as a toggle in `render.yaml`).
- `vitest.config.ts`'s `env` block (a config file, not a test case) sets it to
  `"false"`. When false, `vehicleId` is optional and the ride is created exactly
  as today.
- The service logs a loud warning at boot if the flag is `false` — a mis-set
  flag in production would silently disable verification.
- `tests/integration/testDb.ts` needs **no change**: its `ride.deleteMany()`
  cascades to `RideVehicle`, and `user.deleteMany()` cascades to `Vehicle` and
  `VehicleDocument` (`onDelete: Cascade` in §3), so cleanup stays FK-safe even
  if the dev database holds seeded vehicles.
- Consequence to accept knowingly: the enforcement path (verification on) is
  never exercised by the automated suite.

## 9. Rollout order

1. Schema + migration, `Vehicle` CRUD with plate rules, `RideVehicle`,
   `REQUIRE_APPROVED_VEHICLE` flag + `vitest.config.ts` entry, the
   `createRide`/`editRide` checks and locking.
2. `storage.ts`, MinIO in docker compose, `S3_*` env vars, document upload and
   signed-URL endpoints.
3. Admin review queue, audit entries, approval/rejection emails.
4. Seed data.
5. Frontend pages, dropdown, vehicle card on confirmed bookings.
6. Docs: CLAUDE.md (§9 delivery order, visibility rules, the new flag, lock
   order) and Swagger blocks.

Migrations are run with the explicit `DATABASE_URL` prefix described in
CLAUDE.md (stray-env gotcha).

## 10. Edge-case register

| # | Edge case | Resolution |
|---|---|---|
| 1 | New `Ride` columns would leak plate to every searcher + Redis cache (`findMany` has no `select`) | Snapshot is a separate `RideVehicle` table (§3.2) |
| 2 | ~30 existing tests post rides without a vehicle | `REQUIRE_APPROVED_VEHICLE` flag, off only in `vitest.config.ts` (§8) |
| 3 | `resetDb()` would FK-fail with vehicle rows present | `onDelete: Cascade` on owner/document/ride FKs; helper untouched |
| 4 | Seeded drivers can't post rides under verification | Seed creates approved vehicles (§7) |
| 5 | Plate squatting / rejected vehicle locks the plate forever | `plateKey` nulled on rejection; resubmission re-claims (§3.1) |
| 6 | Approve, then swap car or document | Sensitive edits and doc re-upload reset to `PENDING` |
| 7 | Vehicle edited while a ride is being posted | Vehicle row lock in `createRide`; order Ride -> Vehicle (§3.3) |
| 8 | Two admins review the same vehicle | Vehicle row lock, then `PENDING` check; second gets 409 |
| 9 | Admin reviews own vehicle (DRIVER + ADMIN roles) | 403 |
| 10 | Signed URL host differs inside docker vs the browser | Separate `S3_PUBLIC_ENDPOINT` (§5.1) |
| 11 | Uploaded PDF rendered inline | `Content-Disposition: attachment`, server-chosen type |
| 12 | Upload succeeds, DB write fails (or reverse) | Upload -> DB -> delete old; only harmless orphans possible |
| 13 | Storage not configured (dev, tests, Render before setup) | App boots; only document endpoints 503 |
| 14 | Vehicle capacity lowered after rides posted | Existing rides unaffected; only new rides use it |
| 15 | Vehicle later rejected/pending with live rides | Rides continue; snapshot unchanged; new rides blocked |
| 16 | Cancelled booking exposing the vehicle | Mapper returns `vehicle: null` unless `CONFIRMED` |
| 17 | Flag mis-set to false in production | Default true, not in `render.yaml`, boot warning |
| 18 | Legacy rides with no vehicle | No `RideVehicle` row; UI placeholder |
| 19 | Multipart upload from the frontend | Must send CSRF header; must not set `Content-Type` manually |
