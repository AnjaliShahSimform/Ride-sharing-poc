# Vehicle Details & Admin Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drivers register vehicles with RC/licence documents, an admin approves them, and rides can only be posted with an approved vehicle that confirmed riders can then see.

**Architecture:** New `vehicles` module (routes/controller/service/schemas, same layout as `rides/`) plus admin review routes. A separate `RideVehicle` snapshot table keeps vehicle data out of every existing `ride.findMany` (search, cache, admin). Documents live in an S3-compatible private bucket (MinIO locally) behind a small `storage.ts` wrapper and are only reachable through 60-second signed URLs. Every vehicle write takes the vehicle row lock first.

**Tech Stack:** Express 4, Prisma 5.22 (Postgres), Zod, multer, `@aws-sdk/client-s3` + presigner (client library only — no AWS account), MinIO (docker), React + TanStack Query + Tailwind (`web/`).

**Spec:** [docs/superpowers/specs/2026-10-14-vehicle-verification-design.md](../specs/2026-10-14-vehicle-verification-design.md) — read it first; §3.2 (why `RideVehicle` is a separate table), §3.3 (locking) and §10 (edge-case register) matter most.

## Global Constraints

- **No automated test cases are written or changed** (owner's explicit decision; same category as Bookings / rate limiting / notifications). Do not add files under `tests/` or `web/src/**/*.test.*`, and do not edit existing ones. Verification is `npx tsc -p tsconfig.json --noEmit`, `cd web && npm run build`, running the *existing* suites to confirm they behave exactly as before, and the manual checks in each task.
- `vitest.config.ts` (a config file, not a test) gets `REQUIRE_APPROVED_VEHICLE: "false"` so the ~30 existing integration tests that `POST /api/rides` without a vehicle keep passing. `tests/integration/testDb.ts` must stay untouched — the `onDelete: Cascade` foreign keys keep `resetDb()` FK-safe.
- `REQUIRE_APPROVED_VEHICLE` defaults to **true**; never expose it as a toggle in `render.yaml`.
- Money rules, India-only rules and the existing lock order (Ride → Booking) are unchanged. New order: **Ride → Vehicle**; vehicle writes never take a Ride/Booking lock.
- Ownership errors follow the codebase convention: **404** vehicle doesn't exist, **403** it belongs to someone else.
- Never return `storageKey`, `plateKey`, or document bytes in any API response. Never put a vehicle field on a `Ride` column or in any query that feeds `GET /api/rides/search`.
- Run raw `prisma` CLI commands with explicit `DATABASE_URL`/`DIRECT_URL` prefixed (CLAUDE.md "stray DATABASE_URL gotcha"):
  `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/ride_sharing?schema=public DIRECT_URL=postgresql://postgres:postgres@localhost:5433/ride_sharing?schema=public npx prisma ...`
- Do not commit unless the owner has asked you to. Each task ends with an optional commit step for when they do.
- Money/IDs: UUIDs everywhere; plate numbers are normalised (uppercase, no spaces/dashes) before any comparison or storage.

## Review Focus

Failure modes the spec implies that most need a manual check (each is wired into the task that owns the code):

1. **Vehicle data leaking through search / the Redis cache / `GET /api/rides/mine` of other users** — search must return rides exactly as today (Task 3 check).
2. **A driver editing a vehicle while posting a ride** must not yield a ride on a vehicle that just left `APPROVED` (Task 3 lock + check).
3. **Disguised or oversized upload** (`.exe` renamed `.pdf`, 6 MB file, no file, unknown `type`) must be a clean 400, never a 500 or a stored object (Task 4 checks).
4. **Signed URL unusable from the browser under docker** (internal vs public MinIO host) (Task 4 check).
5. **`REQUIRE_APPROVED_VEHICLE` silently off in production** — default true, boot warning when false (Task 1).

---

## File Structure

**Create**
- `src/lib/storage.ts` — S3 client wrapper (`putObject`, `deleteObject`, `getSignedDownloadUrl`); the only file that knows about S3.
- `src/lib/fileType.ts` — magic-byte sniffing (`sniffDocumentType`).
- `src/modules/vehicles/vehicles.schemas.ts` — Zod schemas, `normalisePlate`, inferred types.
- `src/modules/vehicles/vehicles.service.ts` — all vehicle Prisma calls, locking, review, `assertVehicleCanServeRide`.
- `src/modules/vehicles/vehicles.controller.ts` — thin HTTP adapters (driver + admin handlers).
- `src/modules/vehicles/vehicles.upload.ts` — multer wrapper mapping `MulterError` → 400.
- `src/modules/vehicles/vehicles.routes.ts` — `/api/vehicles` router with Swagger JSDoc.
- `prisma/migrations/<timestamp>_add_vehicle_verification/` — generated.
- `web/src/lib/vehicleTypes.ts`, `web/src/components/VehicleSelect.tsx`, `web/src/pages/MyVehiclesPage.tsx`, `web/src/pages/admin/AdminVehiclesPage.tsx`.

**Modify**
- `prisma/schema.prisma`, `prisma/seed.ts`
- `src/config/env.ts`, `src/server.ts`, `src/app.ts`, `src/lib/AppError.ts`, `src/lib/auditLog.ts`
- `src/middleware/rateLimit.ts`
- `src/modules/rides/rides.schemas.ts`, `rides.service.ts`, `rides.routes.ts` (docs only)
- `src/modules/bookings/bookings.service.ts`, `src/modules/admin/admin.service.ts`, `admin.routes.ts`
- `src/modules/notifications/templates.ts`, `notify.ts`
- `vitest.config.ts`, `docker-compose.yml`, `.env.example`, `.env` (local, untracked), `render.yaml`, `package.json`
- `web/src/lib/api.ts`, `web/src/main.tsx`, `web/src/components/Layout.tsx`, `EditRideForm.tsx`, `web/src/pages/PostRidePage.tsx`, `MyRidesPage.tsx`, `MyBookingsPage.tsx`, `admin/AdminRidesPage.tsx`
- `CLAUDE.md`

---

### Task 1: Schema, migration, env flags, test-config flag

**Files:**
- Modify: `prisma/schema.prisma`, `src/config/env.ts`, `src/server.ts`, `src/lib/auditLog.ts`, `vitest.config.ts`
- Create: migration via `prisma migrate dev`

**Interfaces:**
- Produces: Prisma models `Vehicle`, `VehicleDocument`, `RideVehicle`; enums `VehicleStatus` (`PENDING|APPROVED|REJECTED`), `DocType` (`RC|LICENCE`); `env.REQUIRE_APPROVED_VEHICLE: boolean`; `env.S3_ENDPOINT?`, `S3_PUBLIC_ENDPOINT?`, `S3_BUCKET?`, `S3_ACCESS_KEY?`, `S3_SECRET_KEY?` (all `string | undefined`), `env.S3_REGION: string`; `writeAuditLog` accepting entity type `"Vehicle"`.

- [ ] **Step 1: Record the baseline of the existing suites** (so later "same as before" is checkable)

```bash
cd /home/anjali/Desktop/ride-sharing-poc
docker compose up -d db
npm test 2>&1 | tail -25
cd web && npm test 2>&1 | tail -15
```
Write down which tests (if any) fail. CLAUDE.md already notes `rides.test.ts` "completes the driver's own scheduled ride" is a known failure. Expected after the whole plan: the same set, nothing new.

- [ ] **Step 2: Edit `prisma/schema.prisma`** — add enums after `BookingStatus`, relations to `User` and `Ride`, and the three models at the end.

In `model User`, add under `bookings Booking[]`:
```prisma
  vehicles      Vehicle[]
```
In `model Ride`, add under `bookings Booking[]`:
```prisma
  vehicle        RideVehicle?
```
After `enum BookingStatus { ... }` add:
```prisma
enum VehicleStatus {
  PENDING
  APPROVED
  REJECTED
}

enum DocType {
  RC
  LICENCE
}
```
Append at the end of the file:
```prisma
// A driver's vehicle. Rides can only be posted with an APPROVED one (when
// REQUIRE_APPROVED_VEHICLE is on). `plateKey` is the uniqueness handle: it
// equals `plateNumber` while the vehicle is PENDING/APPROVED and is NULL when
// REJECTED (Postgres allows many NULLs under a unique index), so a rejected or
// squatted registration doesn't lock the real owner out of the plate.
model Vehicle {
  id            String        @id @default(uuid())
  ownerId       String
  owner         User          @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  make          String
  model         String
  colour        String
  plateNumber   String
  plateKey      String?       @unique
  seatCapacity  Int
  status        VehicleStatus @default(PENDING)
  rejectionNote String?
  reviewedById  String?
  reviewedAt    DateTime?
  createdAt     DateTime      @default(now())
  documents     VehicleDocument[]
  rideLinks     RideVehicle[]

  @@index([ownerId])
  @@index([status, createdAt])
}

model VehicleDocument {
  id         String   @id @default(uuid())
  vehicleId  String
  vehicle    Vehicle  @relation(fields: [vehicleId], references: [id], onDelete: Cascade)
  type       DocType
  storageKey String
  mimeType   String
  sizeBytes  Int
  uploadedAt DateTime @default(now())

  @@unique([vehicleId, type])
}

// Snapshot of the vehicle a ride was posted with — what riders booked against.
// Deliberately a separate table, NOT columns on Ride: searchRides, getMyRides
// and the admin rides list all call ride.findMany without a `select`, so any
// column added to Ride would be returned to every searcher and stored in the
// Redis search cache. Nothing returns this table unless a query `include`s it.
model RideVehicle {
  rideId    String  @id
  ride      Ride    @relation(fields: [rideId], references: [id], onDelete: Cascade)
  vehicleId String
  vehicle   Vehicle @relation(fields: [vehicleId], references: [id])
  make      String
  model     String
  colour    String
  plate     String

  @@index([vehicleId])
}
```

- [ ] **Step 3: Create and apply the migration**

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/ride_sharing?schema=public \
DIRECT_URL=postgresql://postgres:postgres@localhost:5433/ride_sharing?schema=public \
npx prisma migrate dev --name add_vehicle_verification
```
Expected: a new folder under `prisma/migrations/`, "Your database is now in sync", and Prisma Client regenerated. Existing rows are untouched (all new tables).

- [ ] **Step 4: Add env vars in `src/config/env.ts`**

Inside `envSchema`, after the `REDIS_ENABLED` block and before `AUTO_COMPLETE_AFTER_HOURS`, add:
```ts
  // Verification gate. Unset means "on": a ride needs an APPROVED vehicle.
  // vitest.config.ts sets "false" so the existing integration suite (which posts
  // rides without a vehicle) keeps passing. Never turn this off in production —
  // server.ts logs a loud warning if it is off.
  REQUIRE_APPROVED_VEHICLE: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
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
```
In the exported `env` object, add after `NOTIFICATIONS_ENABLED`:
```ts
  REQUIRE_APPROVED_VEHICLE: parsed.data.REQUIRE_APPROVED_VEHICLE ?? true,
```

- [ ] **Step 5: Boot warning in `src/server.ts`**

After the `app.listen(...)` block and before `if (env.RUN_WORKER_IN_PROCESS)`, add:
```ts
if (!env.REQUIRE_APPROVED_VEHICLE) {
  logger.warn("REQUIRE_APPROVED_VEHICLE=false: rides can be posted without an approved vehicle");
}
```

- [ ] **Step 6: Allow `"Vehicle"` in the audit log helper** — `src/lib/auditLog.ts`, change the param type:
```ts
  entityType: "Ride" | "Booking" | "Vehicle",
```

- [ ] **Step 7: Set the flag for the existing test suite** — `vitest.config.ts`, extend the `env` block and its comment:
```ts
    // ...(existing comment)... REQUIRE_APPROVED_VEHICLE=false: the existing
    // suite posts rides with no vehicle; verification is off for it by design.
    env: {
      NODE_ENV: "test",
      RATE_LIMIT_ENABLED: "false",
      NOTIFICATIONS_ENABLED: "false",
      REDIS_ENABLED: "false",
      REQUIRE_APPROVED_VEHICLE: "false",
    },
```

- [ ] **Step 8: Verify**

```bash
npx tsc -p tsconfig.json --noEmit
npm test 2>&1 | tail -25
```
Expected: no type errors; the suite result is identical to the Step 1 baseline.

- [ ] **Step 9 (only if the owner has asked for commits): Commit**
```bash
git add prisma src/config/env.ts src/server.ts src/lib/auditLog.ts vitest.config.ts
git commit -m "feat: add vehicle verification schema and env flags"
```

---

### Task 2: Vehicle CRUD module (no documents, no review yet)

**Files:**
- Create: `src/modules/vehicles/vehicles.schemas.ts`, `vehicles.service.ts`, `vehicles.controller.ts`, `vehicles.routes.ts`
- Modify: `src/middleware/rateLimit.ts`, `src/app.ts`

**Interfaces:**
- Consumes: Task 1 models; `writeAuditLog(tx, "Vehicle", ...)`.
- Produces (used by Tasks 3–5):
  - `normalisePlate(raw: string): string`, `PLATE_REGEX`
  - `createVehicleSchema`, `updateVehicleSchema`, `docTypeSchema`, `reviewVehicleSchema`, `reviewQuerySchema` and types `CreateVehicleInput`, `UpdateVehicleInput`, `ReviewVehicleInput`, `ReviewQuery`
  - service: `createVehicle(ownerId, input)`, `getMyVehicles(ownerId)`, `updateVehicle(ownerId, vehicleId, input)`, internal `lockVehicle(tx, vehicleId)`, `isPlateClash(err)`, `vehicleView(v)`, `DOC_SELECT`
  - `vehiclesRouter` mounted at `/api/vehicles`; `vehicleLimiter`, `uploadLimiter`.

- [ ] **Step 1: Create `src/modules/vehicles/vehicles.schemas.ts`**

```ts
import { z } from "zod";

// Uppercase and strip spaces/dashes so "mh-12 ab 1234" and "MH12AB1234" are the
// same plate everywhere (validation, the unique key, comparisons).
export function normalisePlate(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, "");
}

// Indian registration: 2-letter state, 1-2 digit district, 0-3 letter series,
// 4 digits (e.g. MH12AB1234, DL8CAF3456). BH-series plates are out of scope.
export const PLATE_REGEX = /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/;

const text = (name: string) =>
  z.string().trim().min(1, `${name} is required`).max(50, `${name} must be at most 50 characters`);

export const createVehicleSchema = z.object({
  make: text("make"),
  model: text("model"),
  colour: text("colour"),
  plateNumber: z
    .string()
    .transform(normalisePlate)
    .refine((p) => PLATE_REGEX.test(p), "plateNumber must be a valid Indian registration number, e.g. MH12AB1234"),
  // Passenger seats, excluding the driver.
  seatCapacity: z.number().int().min(1).max(8),
});

export const updateVehicleSchema = createVehicleSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Provide at least one field to update");

export const docTypeSchema = z.enum(["RC", "LICENCE"]);

export const reviewVehicleSchema = z
  .object({
    decision: z.enum(["APPROVED", "REJECTED"]),
    note: z.string().trim().max(500, "note must be at most 500 characters").optional(),
  })
  .refine((v) => v.decision !== "REJECTED" || Boolean(v.note), {
    message: "A note is required when rejecting a vehicle",
    path: ["note"],
  });

export const reviewQuerySchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).default("PENDING"),
});

export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;
export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;
export type ReviewVehicleInput = z.infer<typeof reviewVehicleSchema>;
export type ReviewQuery = z.infer<typeof reviewQuerySchema>;
```

- [ ] **Step 2: Create `src/modules/vehicles/vehicles.service.ts`** (CRUD part; Tasks 3–5 append to this file)

```ts
import { Prisma, VehicleStatus } from "@prisma/client";
import type { DocType, Vehicle } from "@prisma/client";
import { ConflictError, ForbiddenError, NotFoundError } from "../../lib/AppError";
import { writeAuditLog } from "../../lib/auditLog";
import { prisma } from "../../lib/prisma";
import type { CreateVehicleInput, UpdateVehicleInput } from "./vehicles.schemas";

// Selecting only type + uploadedAt keeps `storageKey` out of every response.
export const DOC_SELECT = { select: { type: true, uploadedAt: true } } as const;

type VehicleWithDocs = Vehicle & { documents: { type: DocType; uploadedAt: Date }[] };

// The only shape a vehicle leaves this module in: no plateKey, no storage keys.
export function vehicleView(v: VehicleWithDocs) {
  return {
    id: v.id,
    make: v.make,
    model: v.model,
    colour: v.colour,
    plateNumber: v.plateNumber,
    seatCapacity: v.seatCapacity,
    status: v.status,
    rejectionNote: v.rejectionNote,
    reviewedAt: v.reviewedAt,
    createdAt: v.createdAt,
    documents: v.documents.map((d) => ({ type: d.type, uploadedAt: d.uploadedAt })),
  };
}

// Every vehicle write takes this row lock FIRST and only then reads the current
// status. That serialises it against a concurrent edit, upload, admin review or
// ride post (rides.service takes the same lock), so none of them can act on a
// status that changed under them. Order across the app: Ride -> Vehicle; vehicle
// writes never lock a Ride or Booking, so no cycle is possible.
export async function lockVehicle(tx: Prisma.TransactionClient, vehicleId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Vehicle" WHERE "id" = ${vehicleId} FOR UPDATE`;
}

export function isPlateClash(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

const PLATE_TAKEN = "This plate number is already registered";

export async function createVehicle(ownerId: string, input: CreateVehicleInput) {
  try {
    return await prisma.$transaction(async (tx) => {
      const vehicle = await tx.vehicle.create({
        data: { ownerId, ...input, plateKey: input.plateNumber },
      });
      await writeAuditLog(tx, "Vehicle", vehicle.id, "CREATED", ownerId);
      return vehicleView({ ...vehicle, documents: [] });
    });
  } catch (err) {
    if (isPlateClash(err)) {
      throw new ConflictError(PLATE_TAKEN);
    }
    throw err;
  }
}

export async function getMyVehicles(ownerId: string) {
  const vehicles = await prisma.vehicle.findMany({
    where: { ownerId },
    include: { documents: DOC_SELECT },
    orderBy: { createdAt: "desc" },
  });
  return vehicles.map(vehicleView);
}

// Fields whose change invalidates an existing approval. Colour is cosmetic.
const SENSITIVE_FIELDS = ["make", "model", "plateNumber", "seatCapacity"] as const;

export async function updateVehicle(ownerId: string, vehicleId: string, input: UpdateVehicleInput) {
  try {
    return await prisma.$transaction(async (tx) => {
      await lockVehicle(tx, vehicleId);
      const current = await tx.vehicle.findUnique({ where: { id: vehicleId } });
      if (!current) {
        throw new NotFoundError("Vehicle not found");
      }
      if (current.ownerId !== ownerId) {
        throw new ForbiddenError("Only the owner can modify this vehicle");
      }

      const sensitiveChanged = SENSITIVE_FIELDS.some(
        (field) => input[field] !== undefined && input[field] !== current[field],
      );
      // An approved vehicle whose identity changes must be re-reviewed; a
      // rejected one is being resubmitted. Either way it ends up PENDING.
      const nextStatus =
        current.status === VehicleStatus.REJECTED || (current.status === VehicleStatus.APPROVED && sensitiveChanged)
          ? VehicleStatus.PENDING
          : current.status;
      const reset = nextStatus !== current.status;

      const updated = await tx.vehicle.update({
        where: { id: vehicleId },
        data: {
          ...input,
          status: nextStatus,
          // Status is never REJECTED here, so (re)claim the plate.
          plateKey: input.plateNumber ?? current.plateNumber,
          ...(reset && { rejectionNote: null, reviewedById: null, reviewedAt: null }),
        },
        include: { documents: DOC_SELECT },
      });
      await writeAuditLog(tx, "Vehicle", vehicleId, "UPDATED", ownerId, {
        fields: Object.keys(input),
        status: nextStatus,
      });
      return vehicleView(updated);
    });
  } catch (err) {
    if (isPlateClash(err)) {
      throw new ConflictError(PLATE_TAKEN);
    }
    throw err;
  }
}
```

- [ ] **Step 3: Create `src/modules/vehicles/vehicles.controller.ts`** (driver handlers; Tasks 4–5 add more)

```ts
import type { Request, Response } from "express";
import * as vehiclesService from "./vehicles.service";

export async function createVehicleHandler(req: Request, res: Response) {
  const vehicle = await vehiclesService.createVehicle(req.user!.sub, req.body);
  res.status(201).json(vehicle);
}

export async function getMyVehiclesHandler(req: Request, res: Response) {
  const vehicles = await vehiclesService.getMyVehicles(req.user!.sub);
  res.status(200).json(vehicles);
}

export async function updateVehicleHandler(req: Request, res: Response) {
  const vehicle = await vehiclesService.updateVehicle(req.user!.sub, req.params.id, req.body);
  res.status(200).json(vehicle);
}
```

- [ ] **Step 4: Add limiters to `src/middleware/rateLimit.ts`** (append at the end)

```ts
export const vehicleLimiter = createLimiter({ name: "vehicle", windowMs: 60 * 1000, max: 20, key: "user" });
export const uploadLimiter = createLimiter({ name: "vehicleUpload", windowMs: 60 * 60 * 1000, max: 20, key: "user" });
```

- [ ] **Step 5: Create `src/modules/vehicles/vehicles.routes.ts`**

```ts
import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth.middleware";
import { vehicleLimiter } from "../../middleware/rateLimit";
import { validateBody } from "../../middleware/validate";
import { createVehicleHandler, getMyVehiclesHandler, updateVehicleHandler } from "./vehicles.controller";
import { createVehicleSchema, updateVehicleSchema } from "./vehicles.schemas";

export const vehiclesRouter = Router();

vehiclesRouter.use(requireAuth);

/**
 * @swagger
 * components:
 *   schemas:
 *     Vehicle:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         make: { type: string }
 *         model: { type: string }
 *         colour: { type: string }
 *         plateNumber: { type: string, description: "Normalised, e.g. MH12AB1234" }
 *         seatCapacity: { type: integer, description: "Passenger seats, excluding the driver (1-8)" }
 *         status: { type: string, enum: [PENDING, APPROVED, REJECTED] }
 *         rejectionNote: { type: string, nullable: true }
 *         reviewedAt: { type: string, format: date-time, nullable: true }
 *         createdAt: { type: string, format: date-time }
 *         documents:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               type: { type: string, enum: [RC, LICENCE] }
 *               uploadedAt: { type: string, format: date-time }
 */

/**
 * @swagger
 * /api/vehicles:
 *   post:
 *     summary: Register a vehicle (driver only)
 *     description: Created as PENDING. It can't be used for a ride until both an RC and a LICENCE document are uploaded and an admin approves it.
 *     tags: [Vehicles]
 *     security: [{ cookieAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [make, model, colour, plateNumber, seatCapacity]
 *             properties:
 *               make: { type: string }
 *               model: { type: string }
 *               colour: { type: string }
 *               plateNumber: { type: string, description: "Indian registration, spaces/dashes ignored, e.g. MH12AB1234" }
 *               seatCapacity: { type: integer, minimum: 1, maximum: 8 }
 *     responses:
 *       201: { content: { application/json: { schema: { $ref: '#/components/schemas/Vehicle' } } } }
 *       400: { description: Invalid input, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       403: { description: Caller isn't a DRIVER, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       409: { description: Plate already registered, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
vehiclesRouter.post("/", requireRole("DRIVER"), vehicleLimiter, validateBody(createVehicleSchema), asyncHandler(createVehicleHandler));

/**
 * @swagger
 * /api/vehicles/mine:
 *   get:
 *     summary: List the caller's own vehicles with status, rejection note and which documents are uploaded (driver only)
 *     tags: [Vehicles]
 *     security: [{ cookieAuth: [] }]
 *     responses:
 *       200: { content: { application/json: { schema: { type: array, items: { $ref: '#/components/schemas/Vehicle' } } } } }
 *       403: { description: Caller isn't a DRIVER, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
vehiclesRouter.get("/mine", requireRole("DRIVER"), asyncHandler(getMyVehiclesHandler));

/**
 * @swagger
 * /api/vehicles/{id}:
 *   patch:
 *     summary: Edit a vehicle (driver, owner only)
 *     description: Changing make, model, plate or capacity on an APPROVED vehicle sends it back to PENDING for re-review. Colour doesn't. Editing a REJECTED vehicle resubmits it as PENDING. Rides already posted keep their snapshot.
 *     tags: [Vehicles]
 *     security: [{ cookieAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               make: { type: string }
 *               model: { type: string }
 *               colour: { type: string }
 *               plateNumber: { type: string }
 *               seatCapacity: { type: integer, minimum: 1, maximum: 8 }
 *     responses:
 *       200: { content: { application/json: { schema: { $ref: '#/components/schemas/Vehicle' } } } }
 *       400: { description: Invalid input or empty body, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       403: { description: Not the owner, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       404: { description: Vehicle not found, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       409: { description: Plate already registered, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
vehiclesRouter.patch("/:id", requireRole("DRIVER"), vehicleLimiter, validateBody(updateVehicleSchema), asyncHandler(updateVehicleHandler));
```

- [ ] **Step 6: Mount in `src/app.ts`** — add the import next to the other routers and the mount after `/api/bookings`:
```ts
import { vehiclesRouter } from "./modules/vehicles/vehicles.routes";
```
```ts
app.use("/api/vehicles", vehiclesRouter);
```

- [ ] **Step 7: Verify**

```bash
npx tsc -p tsconfig.json --noEmit
npm run dev   # in a second terminal; leave running
```
Manual checks (cookie jar `-c/-b`; every mutating call needs the CSRF header). Use a fresh driver:
```bash
H='-H Content-Type:application/json -H X-Requested-With:XMLHttpRequest'
curl -s -c /tmp/d.jar $H -X POST localhost:3000/api/auth/signup -d '{"name":"V Driver","email":"vd1@example.com","phone":"9000011111","password":"password123","role":"DRIVER"}'
curl -s -b /tmp/d.jar $H -X POST localhost:3000/api/vehicles -d '{"make":"Maruti","model":"Swift","colour":"White","plateNumber":"mh-12 ab 1234","seatCapacity":4}'
```
Expected: 201 with `plateNumber:"MH12AB1234"`, `status:"PENDING"`, no `plateKey`. Then: the same POST again → 409; `plateNumber:"XX"` → 400; `seatCapacity:9` → 400; `GET /api/vehicles/mine` → the vehicle with `documents: []`; PATCH `{"colour":"Black"}` → stays PENDING; PATCH on someone else's id → 403, on a random uuid → 404; a RIDER account calling POST → 403.

- [ ] **Step 8 (only if commits were requested): Commit**
```bash
git add src/modules/vehicles src/middleware/rateLimit.ts src/app.ts
git commit -m "feat: vehicle registration and editing"
```

---

### Task 3: Link vehicles to rides (checks, snapshot, locking, visibility)

**Files:**
- Modify: `src/modules/rides/rides.schemas.ts`, `src/modules/rides/rides.service.ts`, `src/modules/rides/rides.routes.ts` (Swagger only), `src/modules/bookings/bookings.service.ts`, `src/modules/admin/admin.service.ts`
- Modify: `src/modules/vehicles/vehicles.service.ts` (add `assertVehicleCanServeRide`)

**Interfaces:**
- Consumes: Task 2's `lockVehicle`.
- Produces: `assertVehicleCanServeRide(tx, driverId, vehicleId, totalSeats): Promise<Vehicle>`; `createRideSchema` now carries `vehicleId` (required when `env.REQUIRE_APPROVED_VEHICLE`, optional otherwise); `getMyRides`/admin rides include `vehicle` (a `RideVehicle` or null); `getMyBookings` returns `vehicle: { make, model, colour, plate } | null` (CONFIRMED only).

- [ ] **Step 1: Append to `src/modules/vehicles/vehicles.service.ts`**

Add to the imports: `import { ValidationError } from "../../lib/AppError";` (extend the existing AppError import to include it). Then append:
```ts
// Called by rides.service inside the ride's own transaction (createRide / editRide).
// Takes the vehicle row lock, then re-checks everything under it, so a driver
// editing the vehicle (-> PENDING) or an admin review at the same moment can't
// let a ride slip through against a vehicle that just left APPROVED.
export async function assertVehicleCanServeRide(
  tx: Prisma.TransactionClient,
  driverId: string,
  vehicleId: string,
  totalSeats: number,
) {
  await lockVehicle(tx, vehicleId);
  const vehicle = await tx.vehicle.findUnique({ where: { id: vehicleId } });
  if (!vehicle) {
    throw new NotFoundError("Vehicle not found");
  }
  if (vehicle.ownerId !== driverId) {
    throw new ForbiddenError("You can only post rides with your own vehicles");
  }
  if (vehicle.status !== VehicleStatus.APPROVED) {
    throw new ConflictError("This vehicle isn't approved yet");
  }
  if (totalSeats > vehicle.seatCapacity) {
    throw new ValidationError(`totalSeats can't exceed this vehicle's capacity of ${vehicle.seatCapacity}`);
  }
  return vehicle;
}
```

- [ ] **Step 2: `src/modules/rides/rides.schemas.ts`** — add the import and the field.

At the top: `import { env } from "../../config/env";`. Below `requireIndia`:
```ts
const vehicleId = z.string().uuid("vehicleId must be a valid id");
```
In `createRideSchema`'s object, after `estimatedCost`:
```ts
  // Required unless REQUIRE_APPROVED_VEHICLE=false (test suite only).
  vehicleId: env.REQUIRE_APPROVED_VEHICLE ? vehicleId : vehicleId.optional(),
```

- [ ] **Step 3: `src/modules/rides/rides.service.ts`**

Imports — add:
```ts
import { assertVehicleCanServeRide } from "../vehicles/vehicles.service";
```
Add a helper above `createRideTransaction`:
```ts
// What riders booked against; later edits to the Vehicle never change it.
function vehicleSnapshot(vehicle: { id: string; make: string; model: string; colour: string; plateNumber: string }) {
  return {
    vehicleId: vehicle.id,
    make: vehicle.make,
    model: vehicle.model,
    colour: vehicle.colour,
    plate: vehicle.plateNumber,
  };
}
```
Replace the body of `createRideTransaction`'s transaction with:
```ts
  return prisma.$transaction(async (tx) => {
    // Vehicle first: the lock taken inside the check holds off a concurrent
    // vehicle edit/review until this ride (and its snapshot) is committed.
    const vehicle = input.vehicleId
      ? await assertVehicleCanServeRide(tx, driverId, input.vehicleId, input.totalSeats)
      : null;
    const ride = await tx.ride.create({
      data: {
        driverId,
        originLat: input.originLat,
        originLng: input.originLng,
        destLat: input.destLat,
        destLng: input.destLng,
        originLabel: input.originLabel,
        destLabel: input.destLabel,
        departureTime: input.departureTime,
        totalSeats: input.totalSeats,
        // Booking's atomic decrement (design spec §5) mutates this counter;
        // totalSeats itself never changes after creation.
        seatsAvailable: input.totalSeats,
        estimatedCost: input.estimatedCost,
      },
    });
    if (vehicle) {
      await tx.rideVehicle.create({ data: { rideId: ride.id, ...vehicleSnapshot(vehicle) } });
    }
    await writeAuditLog(tx, "Ride", ride.id, "CREATED", driverId, vehicle ? { vehicleId: vehicle.id } : undefined);
    return ride;
  });
```
In `editRideTransaction`, after the `confirmedCount` check and before `const updated = await tx.ride.findUniqueOrThrow(...)`, insert (lock order: the Ride lock was taken by the `updateMany` above, so this is Ride → Vehicle):
```ts
    if (input.vehicleId) {
      const vehicle = await assertVehicleCanServeRide(tx, driverId, input.vehicleId, input.totalSeats);
      const snapshot = vehicleSnapshot(vehicle);
      await tx.rideVehicle.upsert({
        where: { rideId },
        create: { rideId, ...snapshot },
        update: snapshot,
      });
    }
```
Change the audit line in `editRideTransaction` to `await writeAuditLog(tx, "Ride", rideId, "UPDATED", driverId, input.vehicleId ? { vehicleId: input.vehicleId } : undefined);`.

In `getMyRides`, add `include: { vehicle: true },`. Do **not** touch `findMatchingRides` — add this comment above its `prisma.ride.findMany`:
```ts
  // No `include`/`select` on purpose: vehicle data lives in RideVehicle and must
  // never reach search results (or the Redis cache that stores them).
```

- [ ] **Step 4: `src/modules/admin/admin.service.ts`** — `getAllRides`:
```ts
    include: { driver: { select: { id: true, name: true, email: true } }, vehicle: true },
```

- [ ] **Step 5: `src/modules/bookings/bookings.service.ts`** — in `getMyBookings`, change the include and the mapped object:
```ts
    include: { ride: { include: { driver: true, vehicle: true } } },
```
and after `driverContact: ...` add:
```ts
    // Same rule as the driver's contact: only for a CONFIRMED booking, never for
    // a cancelled one.
    vehicle:
      b.status === BookingStatus.CONFIRMED && b.ride.vehicle
        ? {
            make: b.ride.vehicle.make,
            model: b.ride.vehicle.model,
            colour: b.ride.vehicle.colour,
            plate: b.ride.vehicle.plate,
          }
        : null,
```

- [ ] **Step 6: Swagger in `rides.routes.ts`** — add `vehicleId: { type: string, format: uuid, description: "An APPROVED vehicle you own; totalSeats must not exceed its capacity" }` to the `properties` of both the POST and PATCH request bodies (and `vehicleId` to POST/PATCH `required` lists), add a `vehicle` object to the `Ride` schema description (`vehicle: { type: object, nullable: true, description: "Snapshot (make, model, colour, plate). Only present on /api/rides/mine and admin lists — never on search." }`), add `409`/`404` notes to POST (`Vehicle not approved / not found`). Update the search description sentence to: `Never includes driver contact or vehicle fields.`

- [ ] **Step 7: Verify**

```bash
npx tsc -p tsconfig.json --noEmit
npm test 2>&1 | tail -25
```
Expected: no type errors; the suite matches the Task 1 baseline (flag is off in the suite, so existing ride posts work unchanged).

Manual (dev server runs with the flag **on**, since `.env` doesn't set it):
1. As the Task 2 driver: `POST /api/rides` without `vehicleId` → 400 mentioning `vehicleId`. With the PENDING vehicle's id → 409 "isn't approved yet". (Approval is Task 5 — finish this check list after Task 5, or approve by hand: `docker compose exec db psql -U postgres ride_sharing -c "UPDATE \"Vehicle\" SET status='APPROVED' WHERE \"plateNumber\"='MH12AB1234'"`.)
2. With the approved vehicle: `totalSeats:5` → 400 "can't exceed … capacity of 4"; `totalSeats:3` → 201. `GET /api/rides/mine` includes `vehicle` with make/model/colour/plate.
3. **Review Focus 1:** as a RIDER, `GET /api/rides/search` for that ride → JSON has **no** `vehicle`, `make`, `plate` anywhere (`| grep -ci plate` → 0). Book it; `GET /api/bookings/mine` shows `vehicle` populated; cancel the booking, fetch again → `vehicle: null`.
4. **Review Focus 2 (race):** with `psql` open a transaction holding `SELECT ... FOR UPDATE` on that vehicle, fire `POST /api/rides` in another terminal (it must hang), then `UPDATE "Vehicle" SET status='PENDING'` and `COMMIT` → the ride POST resumes and returns 409.
5. Second driver tries the first driver's `vehicleId` → 403.

- [ ] **Step 8 (only if commits were requested): Commit**
```bash
git add src prisma
git commit -m "feat: require an approved vehicle to post a ride, snapshot it on the ride"
```

---

### Task 4: Storage, document upload and signed-URL download

**Files:**
- Create: `src/lib/storage.ts`, `src/lib/fileType.ts`, `src/modules/vehicles/vehicles.upload.ts`
- Modify: `src/lib/AppError.ts`, `src/modules/vehicles/vehicles.service.ts`, `vehicles.controller.ts`, `vehicles.routes.ts`, `docker-compose.yml`, `.env.example`, `.env`, `render.yaml`, `package.json`

**Interfaces:**
- Produces: `ServiceUnavailableError` (503); `storage.putObject(key, body, contentType)`, `storage.deleteObject(key)` (never throws), `storage.getSignedDownloadUrl(key, contentType, expiresInSeconds?)`; `sniffDocumentType(buf): "image/jpeg" | "image/png" | "application/pdf" | null`; service `uploadDocument(ownerId, vehicleId, type, file)`, `getDocumentUrl(actor, vehicleId, type)`; `MAX_DOCUMENT_BYTES`.

- [ ] **Step 1: Install dependencies**

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner multer
npm install -D @types/multer
```
(The AWS SDK is just an S3 *client library*; no AWS account is involved.)

- [ ] **Step 2: Add `ServiceUnavailableError` to `src/lib/AppError.ts`** (append)
```ts
export class ServiceUnavailableError extends AppError {
  constructor(message = "Service temporarily unavailable") {
    super(503, message);
  }
}
```

- [ ] **Step 3: Create `src/lib/fileType.ts`**
```ts
export type DocumentMime = "image/jpeg" | "image/png" | "application/pdf";

// Decides the type from the file's own bytes. The client-supplied Content-Type
// and filename are never trusted: a renamed executable must not get through.
export function sniffDocumentType(buf: Buffer): DocumentMime | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-") {
    return "application/pdf";
  }
  return null;
}
```

- [ ] **Step 4: Create `src/lib/storage.ts`**
```ts
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env";
import { ServiceUnavailableError } from "./AppError";
import { logger } from "./logger";

// The only file that knows about S3. Works against any S3-compatible server
// (MinIO locally; Supabase Storage / Backblaze B2 / Cloudflare R2 / S3 in
// production) — switching is env vars only. The bucket must stay PRIVATE: files
// are only ever reached through short-lived signed URLs.

function settings() {
  const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY } = env;
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY || !S3_SECRET_KEY) {
    // The server boots without storage (like RabbitMQ); only document
    // endpoints are unavailable.
    throw new ServiceUnavailableError("Document storage is not configured");
  }
  return { endpoint: S3_ENDPOINT, bucket: S3_BUCKET, accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY };
}

function makeClient(endpoint: string): S3Client {
  const s = settings();
  return new S3Client({
    region: env.S3_REGION,
    endpoint,
    forcePathStyle: true, // MinIO and most S3-compatible hosts need path-style URLs
    credentials: { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey },
  });
}

let internalClient: S3Client | undefined;
let presignClient: S3Client | undefined;

// Reads/writes: the host the APP can reach (inside docker: http://minio:9000).
function client(): S3Client {
  internalClient ??= makeClient(settings().endpoint);
  return internalClient;
}

// Signing is offline, so it uses the host the BROWSER can reach
// (http://localhost:9000). A signed URL is only valid for the host it was signed for.
function signer(): S3Client {
  presignClient ??= makeClient(env.S3_PUBLIC_ENDPOINT ?? settings().endpoint);
  return presignClient;
}

let bucketReady: Promise<void> | undefined;

function ensureBucket(): Promise<void> {
  const { bucket } = settings();
  bucketReady ??= (async () => {
    try {
      await client().send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await client().send(new CreateBucketCommand({ Bucket: bucket }));
    }
  })().catch((err) => {
    bucketReady = undefined; // retry on the next call instead of caching the failure
    throw err;
  });
  return bucketReady;
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await ensureBucket();
  await client().send(
    new PutObjectCommand({ Bucket: settings().bucket, Key: key, Body: body, ContentType: contentType }),
  );
}

// Best-effort: a failed delete only leaves an orphan object, never a bad row.
export async function deleteObject(key: string): Promise<void> {
  try {
    await client().send(new DeleteObjectCommand({ Bucket: settings().bucket, Key: key }));
  } catch (err) {
    logger.warn({ err, key }, "Failed to delete stored object");
  }
}

// Forces a download (never inline rendering) with a server-chosen content type.
export function getSignedDownloadUrl(key: string, contentType: string, expiresInSeconds = 60): Promise<string> {
  return getSignedUrl(
    signer(),
    new GetObjectCommand({
      Bucket: settings().bucket,
      Key: key,
      ResponseContentDisposition: "attachment",
      ResponseContentType: contentType,
    }),
    { expiresIn: expiresInSeconds },
  );
}
```

- [ ] **Step 5: Create `src/modules/vehicles/vehicles.upload.ts`**
```ts
import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { ValidationError } from "../../lib/AppError";

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 },
}).single("file");

// MulterError isn't an AppError, so without this a too-big file would be a 500.
export function uploadSingleFile(req: Request, res: Response, next: NextFunction) {
  upload(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      next(
        new ValidationError(
          err.code === "LIMIT_FILE_SIZE" ? "File must be 5 MB or smaller" : "Upload one file in the 'file' field",
        ),
      );
      return;
    }
    next(err);
  });
}
```

- [ ] **Step 6: Append to `src/modules/vehicles/vehicles.service.ts`**

Add imports: `import { sniffDocumentType } from "../../lib/fileType";`, `import * as storage from "../../lib/storage";`, `import { randomUUID } from "node:crypto";`, and extend the AppError import with `ValidationError` if Task 3 didn't already. Then:
```ts
export async function uploadDocument(
  ownerId: string,
  vehicleId: string,
  type: DocType,
  file: { buffer: Buffer } | undefined,
) {
  if (!file) {
    throw new ValidationError("A file is required in the 'file' field");
  }
  const mimeType = sniffDocumentType(file.buffer);
  if (!mimeType) {
    throw new ValidationError("Only JPEG, PNG or PDF files are allowed");
  }

  // Cheap ownership check BEFORE anything is stored, so a non-owner can't make
  // us write objects. Re-checked under the lock below.
  const existing = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
  if (!existing) {
    throw new NotFoundError("Vehicle not found");
  }
  if (existing.ownerId !== ownerId) {
    throw new ForbiddenError("Only the owner can upload documents for this vehicle");
  }

  // Order: store the new object, then write the row, then delete the old object.
  // A failure leaves at worst an orphan object, never a row pointing at nothing.
  const storageKey = `vehicles/${vehicleId}/${type}/${randomUUID()}`;
  await storage.putObject(storageKey, file.buffer, mimeType);

  let previousKey: string | undefined;
  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockVehicle(tx, vehicleId);
      const vehicle = await tx.vehicle.findUnique({ where: { id: vehicleId } });
      if (!vehicle || vehicle.ownerId !== ownerId) {
        throw new NotFoundError("Vehicle not found");
      }
      const old = await tx.vehicleDocument.findUnique({ where: { vehicleId_type: { vehicleId, type } } });
      previousKey = old?.storageKey;

      await tx.vehicleDocument.upsert({
        where: { vehicleId_type: { vehicleId, type } },
        create: { vehicleId, type, storageKey, mimeType, sizeBytes: file.buffer.length },
        update: { storageKey, mimeType, sizeBytes: file.buffer.length, uploadedAt: new Date() },
      });

      // Replacing a document on an approved vehicle, or uploading to a rejected
      // one, puts it back in the review queue (and re-claims the plate).
      const resubmit = vehicle.status !== VehicleStatus.PENDING;
      if (resubmit) {
        await tx.vehicle.update({
          where: { id: vehicleId },
          data: {
            status: VehicleStatus.PENDING,
            plateKey: vehicle.plateNumber,
            rejectionNote: null,
            reviewedById: null,
            reviewedAt: null,
          },
        });
      }
      await writeAuditLog(tx, "Vehicle", vehicleId, "DOCUMENT_UPLOADED", ownerId, { type, resubmitted: resubmit });
      return tx.vehicle.findUniqueOrThrow({ where: { id: vehicleId }, include: { documents: DOC_SELECT } });
    });
    if (previousKey) {
      await storage.deleteObject(previousKey);
    }
    return vehicleView(result);
  } catch (err) {
    await storage.deleteObject(storageKey);
    if (isPlateClash(err)) {
      throw new ConflictError(PLATE_TAKEN);
    }
    throw err;
  }
}

// Only the owner or an admin may get a link, and the AuditLog row is written
// BEFORE the URL is issued, so there is a record of every document view.
export async function getDocumentUrl(
  actor: { sub: string; roles: string[] },
  vehicleId: string,
  type: DocType,
) {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    include: { documents: { where: { type } } },
  });
  if (!vehicle) {
    throw new NotFoundError("Vehicle not found");
  }
  if (vehicle.ownerId !== actor.sub && !actor.roles.includes("ADMIN")) {
    throw new ForbiddenError("Not allowed to view this document");
  }
  const doc = vehicle.documents[0];
  if (!doc) {
    throw new NotFoundError("Document not uploaded");
  }

  await prisma.$transaction((tx) =>
    writeAuditLog(tx, "Vehicle", vehicleId, "DOCUMENT_VIEWED", actor.sub, { type }),
  );
  const url = await storage.getSignedDownloadUrl(doc.storageKey, doc.mimeType, 60);
  return { url, expiresInSeconds: 60 };
}
```

- [ ] **Step 7: Add handlers to `src/modules/vehicles/vehicles.controller.ts`**
```ts
import { docTypeSchema } from "./vehicles.schemas";

export async function uploadDocumentHandler(req: Request, res: Response) {
  // `type` arrives as a multipart text field; parse() throws a ZodError -> 400.
  const type = docTypeSchema.parse(req.body?.type);
  const vehicle = await vehiclesService.uploadDocument(req.user!.sub, req.params.id, type, req.file);
  res.status(201).json(vehicle);
}

export async function getDocumentUrlHandler(req: Request, res: Response) {
  const type = docTypeSchema.parse(req.params.type);
  const result = await vehiclesService.getDocumentUrl(req.user!, req.params.id, type);
  res.status(200).json(result);
}
```

- [ ] **Step 8: Add routes to `vehicles.routes.ts`**

Imports: `import { uploadLimiter, vehicleLimiter } from "../../middleware/rateLimit";` (replace the Task 2 limiter import), `import { uploadSingleFile } from "./vehicles.upload";`, and add the two handlers to the controller import. Append:
```ts
/**
 * @swagger
 * /api/vehicles/{id}/documents:
 *   post:
 *     summary: Upload an RC or LICENCE document (driver, owner only)
 *     description: multipart/form-data with `type` (RC or LICENCE) and `file` (JPEG, PNG or PDF, max 5 MB; the type is checked from the file's bytes, not its name). Replaces any previous document of that type. Uploading to an APPROVED or REJECTED vehicle puts it back to PENDING.
 *     tags: [Vehicles]
 *     security: [{ cookieAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [type, file]
 *             properties:
 *               type: { type: string, enum: [RC, LICENCE] }
 *               file: { type: string, format: binary }
 *     responses:
 *       201: { content: { application/json: { schema: { $ref: '#/components/schemas/Vehicle' } } } }
 *       400: { description: "Missing/oversized/disguised file or bad type", content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       403: { description: Not the owner, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       404: { description: Vehicle not found, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       503: { description: Document storage not configured, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
vehiclesRouter.post("/:id/documents", requireRole("DRIVER"), uploadLimiter, uploadSingleFile, asyncHandler(uploadDocumentHandler));

/**
 * @swagger
 * /api/vehicles/{id}/documents/{type}:
 *   get:
 *     summary: Get a 60-second signed download URL for a document (owner or admin)
 *     description: Every call is written to the audit log. The link forces a download.
 *     tags: [Vehicles]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: type, required: true, schema: { type: string, enum: [RC, LICENCE] } }
 *     responses:
 *       200: { content: { application/json: { schema: { type: object, properties: { url: { type: string }, expiresInSeconds: { type: integer } } } } } }
 *       403: { description: Neither owner nor admin, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       404: { description: Vehicle or document not found, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       503: { description: Document storage not configured, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
vehiclesRouter.get("/:id/documents/:type", requireRole("DRIVER", "ADMIN"), asyncHandler(getDocumentUrlHandler));
```
Order matters: `requireAuth` → `requireRole` → `uploadLimiter` → multer, so unauthenticated or wrong-role callers never get their body buffered.

- [ ] **Step 9: MinIO in `docker-compose.yml`**

Add the service after `mailpit`:
```yaml
  # S3-compatible object store for vehicle documents (RC / licence). No account
  # needed; console at http://localhost:9001 (minioadmin / minioadmin).
  minio:
    image: minio/minio
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports:
      - "9000:9000" # S3 API
      - "9001:9001" # web console
    volumes:
      - minio_data:/data
```
In `app`'s `depends_on` add `minio: { condition: service_started }`; in `app`'s `environment` add:
```yaml
      S3_ENDPOINT: http://minio:9000
      S3_PUBLIC_ENDPOINT: http://localhost:9000
      S3_BUCKET: vehicle-docs
      S3_ACCESS_KEY: minioadmin
      S3_SECRET_KEY: minioadmin
```
Add `minio_data:` under `volumes:`.

- [ ] **Step 10: Env files**

Append to `.env.example` **and** to your local `.env` (untracked):
```
# Vehicle verification. Defaults to true; never set false in production.
# REQUIRE_APPROVED_VEHICLE=true

# S3-compatible object storage for vehicle documents (RC / licence).
# Local: `docker compose up -d minio` (console http://localhost:9001, minioadmin/minioadmin).
# Production: any S3-compatible host (e.g. Supabase Storage free tier — no card).
# S3_PUBLIC_ENDPOINT must be the host the BROWSER can reach; inside docker
# S3_ENDPOINT differs from it (http://minio:9000 vs http://localhost:9000).
S3_ENDPOINT=http://localhost:9000
S3_PUBLIC_ENDPOINT=http://localhost:9000
S3_BUCKET=vehicle-docs
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_REGION=us-east-1
```
Append to `render.yaml` `envVars` (api service): `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` each `sync: false`, and `S3_REGION` `value: us-east-1`. Do **not** add `REQUIRE_APPROVED_VEHICLE`.

- [ ] **Step 11: Verify**

```bash
npx tsc -p tsconfig.json --noEmit
docker compose up -d minio
# restart `npm run dev` so it reads the new .env
```
With the Task 2 driver and vehicle id `$V` (use real files: any `.jpg`/`.pdf`):
- Upload `RC` with a real PDF → 201 and `documents:[{type:"RC",...}]` (no `storageKey`). Upload `LICENCE` with a JPEG → 201. Open http://localhost:9001 → bucket `vehicle-docs` has both objects.
- **Review Focus 3:** `printf 'MZ fake' > fake.pdf` upload → 400 "Only JPEG, PNG or PDF"; `head -c 6000000 /dev/urandom > big.bin` → 400 "5 MB"; no file → 400; `type=OTHER` → 400; another driver's vehicle → 403. Confirm none of the failing uploads created a bucket object.
- `GET /api/vehicles/$V/documents/RC` → `{url, expiresInSeconds:60}`. **Review Focus 4:** `curl -sI "<url>"` → 200 with `content-disposition: attachment`; wait >60 s → 403. A second driver calling it → 403; a missing doc type → 404.
- Re-upload `RC` → old object disappears from the bucket. With MinIO stopped (`docker compose stop minio`) an upload returns a 5xx/503 and the rest of the API (e.g. `GET /api/vehicles/mine`) still works; with `S3_ENDPOINT` unset the endpoints return 503 "not configured".
- `GET /api/admin/audit-logs` (admin) shows `DOCUMENT_UPLOADED` / `DOCUMENT_VIEWED` rows without any storage key.

- [ ] **Step 12 (only if commits were requested): Commit**
```bash
git add src package.json package-lock.json docker-compose.yml .env.example render.yaml
git commit -m "feat: vehicle document upload with private storage and signed URLs"
```

---

### Task 5: Admin review queue, review decision, approval/rejection emails

**Files:**
- Modify: `src/modules/vehicles/vehicles.service.ts`, `vehicles.controller.ts`, `src/modules/admin/admin.routes.ts`, `src/modules/notifications/templates.ts`, `notify.ts`

**Interfaces:**
- Consumes: Task 2 `lockVehicle`, `vehicleView`, `DOC_SELECT`; Task 2 schemas `reviewVehicleSchema`, `reviewQuerySchema`.
- Produces: `listVehiclesForReview(status)`, `reviewVehicle(adminId, vehicleId, input)`; `notifyVehicleReviewed`; email template `VEHICLE_REVIEWED`; routes `GET /api/admin/vehicles`, `PATCH /api/admin/vehicles/:id/review`.

- [ ] **Step 1: Template — `src/modules/notifications/templates.ts`**

In `TemplateVars` add:
```ts
  // To the driver whose vehicle an admin just approved or rejected.
  VEHICLE_REVIEWED: {
    ownerName: string;
    vehicle: string; // e.g. "White Maruti Swift (MH12AB1234)"
    decision: "APPROVED" | "REJECTED";
    note?: string;
  };
```
In `renderers` add:
```ts
  VEHICLE_REVIEWED: (v) =>
    v.decision === "APPROVED"
      ? compose("Your vehicle was approved", v.ownerName, [
          `${v.vehicle} is approved. You can now post rides with it.`,
        ])
      : compose("Your vehicle was not approved", v.ownerName, [
          `${v.vehicle} was not approved.`,
          ...(v.note ? [`Reason: ${v.note}`] : []),
          "Fix the issue and re-upload your documents to resubmit it.",
        ]),
```

- [ ] **Step 2: `src/modules/notifications/notify.ts`** — extend the type import to `import type { Prisma, Ride, User, Vehicle } from "@prisma/client";` and append:
```ts
// To the vehicle's owner only, at their own address.
export async function notifyVehicleReviewed(
  tx: Prisma.TransactionClient,
  args: { vehicle: Vehicle; owner: User; decision: "APPROVED" | "REJECTED"; note?: string },
) {
  const { vehicle, owner, decision, note } = args;
  await enqueueEmail(tx, "VEHICLE_REVIEWED", owner.email, {
    ownerName: owner.name,
    vehicle: `${vehicle.colour} ${vehicle.make} ${vehicle.model} (${vehicle.plateNumber})`,
    decision,
    note,
  });
}
```

- [ ] **Step 3: Append to `vehicles.service.ts`**

Imports: `import { notifyVehicleReviewed } from "../notifications/notify";`, and extend the schemas type import with `ReviewVehicleInput`. Then:
```ts
// Oldest first, so the queue is worked in submission order. The plate is NOT
// masked: the review is a comparison of the declared plate against the RC.
export async function listVehiclesForReview(status: VehicleStatus) {
  const vehicles = await prisma.vehicle.findMany({
    where: { status },
    include: { documents: DOC_SELECT, owner: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  return vehicles.map((v) => ({ ...vehicleView(v), owner: v.owner }));
}

export async function reviewVehicle(adminId: string, vehicleId: string, input: ReviewVehicleInput) {
  return prisma.$transaction(async (tx) => {
    // Same lock as every vehicle write: two admins (or an admin and the driver
    // re-uploading) serialise here; the loser sees a non-PENDING status -> 409.
    await lockVehicle(tx, vehicleId);
    const vehicle = await tx.vehicle.findUnique({
      where: { id: vehicleId },
      include: { owner: true, documents: DOC_SELECT },
    });
    if (!vehicle) {
      throw new NotFoundError("Vehicle not found");
    }
    if (vehicle.ownerId === adminId) {
      throw new ForbiddenError("You can't review your own vehicle");
    }
    if (vehicle.status !== VehicleStatus.PENDING) {
      throw new ConflictError(`Vehicle is already ${vehicle.status.toLowerCase()}`);
    }
    if (input.decision === "APPROVED") {
      const uploaded = new Set(vehicle.documents.map((d) => d.type));
      if (!uploaded.has("RC") || !uploaded.has("LICENCE")) {
        throw new ConflictError("Both RC and licence documents must be uploaded before approval");
      }
    }

    const rejected = input.decision === "REJECTED";
    const updated = await tx.vehicle.update({
      where: { id: vehicleId },
      data: {
        status: input.decision,
        rejectionNote: rejected ? (input.note ?? null) : null,
        reviewedById: adminId,
        reviewedAt: new Date(),
        // Rejection frees the plate; approval keeps (already holds) it.
        plateKey: rejected ? null : vehicle.plateNumber,
      },
      include: { documents: DOC_SELECT },
    });
    await writeAuditLog(tx, "Vehicle", vehicleId, input.decision, adminId, { note: input.note });
    await notifyVehicleReviewed(tx, {
      vehicle: updated,
      owner: vehicle.owner,
      decision: input.decision,
      note: input.note,
    });
    return vehicleView(updated);
  });
}
```

- [ ] **Step 4: Controller handlers** — append to `vehicles.controller.ts`:
```ts
import type { ReviewQuery } from "./vehicles.schemas";

export async function listVehiclesForReviewHandler(req: Request, res: Response) {
  const { status } = req.query as unknown as ReviewQuery;
  const vehicles = await vehiclesService.listVehiclesForReview(status);
  res.status(200).json(vehicles);
}

export async function reviewVehicleHandler(req: Request, res: Response) {
  const vehicle = await vehiclesService.reviewVehicle(req.user!.sub, req.params.id, req.body);
  res.status(200).json(vehicle);
}
```

- [ ] **Step 5: Admin routes — `src/modules/admin/admin.routes.ts`**

Imports:
```ts
import { validateBody, validateQuery } from "../../middleware/validate";
import { listVehiclesForReviewHandler, reviewVehicleHandler } from "../vehicles/vehicles.controller";
import { reviewQuerySchema, reviewVehicleSchema } from "../vehicles/vehicles.schemas";
```
(replace the existing `validateQuery`-only import). Append (the router already applies `requireAuth, requireRole("ADMIN")`):
```ts
/**
 * @swagger
 * /api/admin/vehicles:
 *   get:
 *     summary: Vehicle review queue (admin only), oldest first
 *     description: Defaults to PENDING. Each vehicle includes its owner ({ id, name, email }) and which documents are uploaded. View a document through GET /api/vehicles/{id}/documents/{type}.
 *     tags: [Admin]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: query, name: status, required: false, schema: { type: string, enum: [PENDING, APPROVED, REJECTED], default: PENDING } }
 *     responses:
 *       200: { content: { application/json: { schema: { type: array, items: { $ref: '#/components/schemas/Vehicle' } } } } }
 *       403: { description: Caller isn't an ADMIN, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
adminRouter.get("/vehicles", validateQuery(reviewQuerySchema), asyncHandler(listVehiclesForReviewHandler));

/**
 * @swagger
 * /api/admin/vehicles/{id}/review:
 *   patch:
 *     summary: Approve or reject a PENDING vehicle (admin only)
 *     description: Approval needs both RC and LICENCE uploaded (409 otherwise). Rejection needs a note and frees the plate. Only a PENDING vehicle can be reviewed (409 otherwise, including when another admin decided first). An admin can't review their own vehicle (403). The owner is emailed.
 *     tags: [Admin]
 *     security: [{ cookieAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [decision]
 *             properties:
 *               decision: { type: string, enum: [APPROVED, REJECTED] }
 *               note: { type: string, maxLength: 500, description: "Required when REJECTED" }
 *     responses:
 *       200: { content: { application/json: { schema: { $ref: '#/components/schemas/Vehicle' } } } }
 *       400: { description: Invalid decision or missing rejection note, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       403: { description: Not an admin, or reviewing own vehicle, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       404: { description: Vehicle not found, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       409: { description: "Not PENDING, or documents missing", content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
adminRouter.patch("/vehicles/:id/review", validateBody(reviewVehicleSchema), asyncHandler(reviewVehicleHandler));
```
Also in the existing audit-logs Swagger block change `entityType` enum to `[Ride, Booking, Vehicle]`.

- [ ] **Step 6: Verify**

```bash
npx tsc -p tsconfig.json --noEmit
docker compose up -d rabbitmq mailpit   # so the emails actually go out
```
Using the Task 2/4 driver and vehicle (`PENDING`, both docs uploaded) and the seeded admin (`admin@example.com` / `password123`, jar `/tmp/a.jar`):
- `GET /api/admin/vehicles` → lists it with `owner` and both `documents`; a driver/rider → 403.
- `GET /api/vehicles/$V/documents/RC` as the admin → a URL that downloads the file.
- `PATCH .../review {"decision":"REJECTED"}` → 400 (note required). With a note → 200 `REJECTED`; the plate is free again (a second driver can register `MH12AB1234` — then delete that vehicle row or use another plate). Review again → 409 "already rejected".
- Driver re-uploads a document → vehicle back to `PENDING` (`GET /api/vehicles/mine`), note cleared. Approve → 200 `APPROVED`; http://localhost:8025 (Mailpit) shows the approval and rejection emails addressed only to the driver.
- Approve a vehicle with only one document → 409. A user with both DRIVER and ADMIN roles reviewing their own vehicle → 403 (set roles via SQL to test).
- Two simultaneous `PATCH review` calls on one PENDING vehicle (`curl ... & curl ... & wait`) → exactly one 200, one 409.
- `GET /api/admin/audit-logs` shows `APPROVED`/`REJECTED` rows with the admin's id.

- [ ] **Step 7 (only if commits were requested): Commit**
```bash
git add src
git commit -m "feat: admin vehicle review queue with approval and rejection emails"
```

---

### Task 6: Seed data

**Files:** Modify `prisma/seed.ts`

**Interfaces:** Consumes the Task 1 models. Produces: approved vehicles for every seeded driver, snapshots on seeded SCHEDULED rides, one PENDING vehicle for the admin queue.

- [ ] **Step 1: Extend the re-run cleanup.** After `await prisma.ride.deleteMany({ where: { driverId: { in: seededDriverIds } } });` (deleting rides cascades their `RideVehicle` rows) add:
```ts
  await prisma.vehicle.deleteMany({ where: { ownerId: { in: seededDriverIds } } });
```

- [ ] **Step 2: Create the vehicles, before `prisma.ride.createMany`.** Check the seeded rides' `totalSeats` first: `grep -n "totalSeats" prisma/seed.ts` — every capacity below must be ≥ the largest `totalSeats` of that driver's rides (raise `seatCapacity` to 8 if not).
```ts
  // Seeded vehicles skip the document workflow (like the seed already skips
  // signup): APPROVED so drivers can post rides straight away. Kiran also has a
  // PENDING one so the admin review queue isn't empty — upload an RC and a
  // licence for it through the UI to try the approval path.
  const approvedVehicleByDriver = new Map<string, string>();
  const approvedVehicles = [
    { owner: dara, make: "Maruti", model: "Swift", colour: "White", plateNumber: "GJ01AB1234", seatCapacity: 4 },
    { owner: ravi, make: "Hyundai", model: "Creta", colour: "Grey", plateNumber: "MH12CD5678", seatCapacity: 4 },
    { owner: priya, make: "Honda", model: "City", colour: "Black", plateNumber: "KA03EF9012", seatCapacity: 4 },
    { owner: kiran, make: "Toyota", model: "Innova", colour: "Silver", plateNumber: "DL8CAF3456", seatCapacity: 6 },
  ];
  for (const { owner, ...fields } of approvedVehicles) {
    const vehicle = await prisma.vehicle.create({
      data: { ownerId: owner.id, ...fields, plateKey: fields.plateNumber, status: "APPROVED", reviewedAt: new Date() },
    });
    approvedVehicleByDriver.set(owner.id, vehicle.id);
  }
  await prisma.vehicle.create({
    data: {
      ownerId: kiran.id,
      make: "Tata",
      model: "Nexon",
      colour: "Blue",
      plateNumber: "RJ14GH7890",
      plateKey: "RJ14GH7890",
      seatCapacity: 4,
    },
  });
```

- [ ] **Step 3: Link the seeded SCHEDULED rides to their driver's vehicle**, immediately after the `prisma.ride.createMany({...})` call (cancelled/completed ones stay vehicle-less on purpose, so both UI states show):
```ts
  for (const driver of [dara, ravi, priya, kiran]) {
    const vehicleId = approvedVehicleByDriver.get(driver.id)!;
    const vehicle = approvedVehicles.find((v) => v.owner.id === driver.id)!;
    const scheduled = await prisma.ride.findMany({
      where: { driverId: driver.id, status: RideStatus.SCHEDULED },
      select: { id: true },
    });
    await prisma.rideVehicle.createMany({
      data: scheduled.map((r) => ({
        rideId: r.id,
        vehicleId,
        make: vehicle.make,
        model: vehicle.model,
        colour: vehicle.colour,
        plate: vehicle.plateNumber,
      })),
    });
  }
```

- [ ] **Step 4: Verify**

```bash
npx tsc -p tsconfig.json --noEmit
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/ride_sharing?schema=public \
DIRECT_URL=postgresql://postgres:postgres@localhost:5433/ride_sharing?schema=public \
npm run db:seed
npm run db:seed   # second run must succeed too (re-run cleanup)
```
Expected: both runs finish; `docker compose exec db psql -U postgres ride_sharing -c 'select "plateNumber", status from "Vehicle"'` lists 5 vehicles (not 10 after the second run). Log in as `dara.driver@example.com` and post a ride with the Swift → 201.

- [ ] **Step 5 (only if commits were requested): Commit**
```bash
git add prisma/seed.ts
git commit -m "feat: seed approved vehicles and a pending one for the review queue"
```

---

### Task 7: Frontend foundation — multipart `apiFetch`, types, vehicle picker, My vehicles page, nav and routes

**Files:**
- Create: `web/src/lib/vehicleTypes.ts`, `web/src/components/VehicleSelect.tsx`, `web/src/pages/MyVehiclesPage.tsx`
- Modify: `web/src/lib/api.ts`, `web/src/components/Layout.tsx`, `web/src/main.tsx`

**Interfaces:**
- Produces: `apiFetch` accepting a `FormData` body (no JSON Content-Type, no stringify); types `Vehicle`, `VehicleStatus`, `DocType`, `VehicleSummary`, `formatVehicle(v)`; `<VehicleSelect value onChange seatsNeeded? />`; routes `/vehicles/mine`, nav link "My vehicles".

- [ ] **Step 1: `web/src/lib/api.ts` — support `FormData`.** Replace the header/body construction in `apiFetch`:
```ts
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  // A FormData body must NOT get a JSON Content-Type: the browser has to set
  // multipart/form-data itself, boundary included.
  const isForm = typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers: Record<string, string> = isForm ? {} : { "Content-Type": "application/json" };
  if (MUTATING_METHODS.has(method)) {
    headers[CSRF_HEADER_NAME] = CSRF_HEADER_VALUE;
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    credentials: "include",
    body: options.body ? (isForm ? (options.body as FormData) : JSON.stringify(options.body)) : undefined,
  });
```
(The rest of the function is unchanged; non-FormData requests behave exactly as before, so `api.test.ts` still passes.)

- [ ] **Step 2: Create `web/src/lib/vehicleTypes.ts`**
```ts
export type VehicleStatus = "PENDING" | "APPROVED" | "REJECTED";
export type DocType = "RC" | "LICENCE";

export interface Vehicle {
  id: string;
  make: string;
  model: string;
  colour: string;
  plateNumber: string;
  seatCapacity: number;
  status: VehicleStatus;
  rejectionNote: string | null;
  createdAt: string;
  documents: { type: DocType; uploadedAt: string }[];
}

// What a ride/booking carries: a snapshot, not the live vehicle.
export interface VehicleSummary {
  make: string;
  model: string;
  colour: string;
  plate: string;
}

export function formatVehicle(v: VehicleSummary): string {
  return `${v.colour} ${v.make} ${v.model} · ${v.plate}`;
}

export const DOC_LABEL: Record<DocType, string> = { RC: "RC (registration certificate)", LICENCE: "Driving licence" };

export const vehicleStatusBadgeClass: Record<VehicleStatus, string> = {
  PENDING: "bg-yellow-100 text-yellow-800",
  APPROVED: "bg-green-100 text-green-700",
  REJECTED: "bg-red-100 text-red-700",
};

// Opens a short-lived signed URL in a new tab. The link is fetched on click
// because it expires after 60 seconds.
export async function openDocument(apiFetch: <T>(path: string) => Promise<T>, vehicleId: string, type: DocType) {
  const { url } = await apiFetch<{ url: string }>(`/api/vehicles/${vehicleId}/documents/${type}`);
  window.open(url, "_blank", "noopener");
}
```

- [ ] **Step 3: Create `web/src/components/VehicleSelect.tsx`**
```tsx
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiFetch } from "../lib/api";
import type { Vehicle } from "../lib/vehicleTypes";

interface VehicleSelectProps {
  value: string;
  onChange: (vehicleId: string) => void;
  // Vehicles too small for the seats being offered are disabled.
  seatsNeeded?: number;
  className?: string;
}

// Dropdown of the driver's APPROVED vehicles only. The server re-checks
// ownership, approval and capacity on submit; this is just the friendly path.
export function VehicleSelect({ value, onChange, seatsNeeded = 1, className }: VehicleSelectProps) {
  const { data, isLoading } = useQuery<Vehicle[]>({
    queryKey: ["vehicles", "mine"],
    queryFn: () => apiFetch("/api/vehicles/mine"),
  });
  const approved = (Array.isArray(data) ? data : []).filter((v) => v.status === "APPROVED");

  if (isLoading) return <p className="text-sm text-gray-500">Loading vehicles...</p>;

  if (approved.length === 0) {
    return (
      <p className="rounded-md bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
        You need an approved vehicle to post a ride.{" "}
        <Link to="/vehicles/mine" className="font-medium underline">
          Add or check your vehicles
        </Link>
      </p>
    );
  }

  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} required className={className}>
      <option value="">Select a vehicle</option>
      {approved.map((v) => (
        <option key={v.id} value={v.id} disabled={seatsNeeded > v.seatCapacity}>
          {v.colour} {v.make} {v.model} · {v.plateNumber} ({v.seatCapacity} seats)
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 4: Create `web/src/pages/MyVehiclesPage.tsx`**
```tsx
import { type FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "../lib/api";
import {
  DOC_LABEL,
  type DocType,
  type Vehicle,
  openDocument,
  vehicleStatusBadgeClass,
} from "../lib/vehicleTypes";

const DOC_TYPES: DocType[] = ["RC", "LICENCE"];

export function MyVehiclesPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [colour, setColour] = useState("");
  const [plateNumber, setPlateNumber] = useState("");
  const [seatCapacity, setSeatCapacity] = useState("4");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery<Vehicle[]>({
    queryKey: ["vehicles", "mine"],
    queryFn: () => apiFetch("/api/vehicles/mine"),
  });

  const refresh = () => queryClient.refetchQueries({ queryKey: ["vehicles", "mine"] });
  const message = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong");

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch("/api/vehicles", {
        method: "POST",
        body: { make, model, colour, plateNumber, seatCapacity: Number(seatCapacity) },
      });
      setMake("");
      setModel("");
      setColour("");
      setPlateNumber("");
      setSeatCapacity("4");
      await refresh();
    } catch (err) {
      setError(message(err));
    }
  }

  async function handleUpload(vehicleId: string, type: DocType, file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusyKey(`${vehicleId}:${type}`);
    try {
      const form = new FormData();
      form.append("type", type);
      form.append("file", file);
      await apiFetch(`/api/vehicles/${vehicleId}/documents`, { method: "POST", body: form });
      await refresh();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleView(vehicleId: string, type: DocType) {
    setError(null);
    try {
      await openDocument(apiFetch, vehicleId, type);
    } catch (err) {
      setError(message(err));
    }
  }

  const inputClass =
    "mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
  const labelClass = "block text-sm font-medium text-gray-700";

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">My vehicles</h1>
      {error && (
        <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <form onSubmit={handleAdd} className="mb-8 rounded-xl bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-medium text-gray-900">Add a vehicle</h2>
        <div className="grid grid-cols-2 gap-4">
          <label className={labelClass}>
            Make
            <input value={make} onChange={(e) => setMake(e.target.value)} required className={inputClass} />
          </label>
          <label className={labelClass}>
            Model
            <input value={model} onChange={(e) => setModel(e.target.value)} required className={inputClass} />
          </label>
          <label className={labelClass}>
            Colour
            <input value={colour} onChange={(e) => setColour(e.target.value)} required className={inputClass} />
          </label>
          <label className={labelClass}>
            Plate number
            <input
              value={plateNumber}
              onChange={(e) => setPlateNumber(e.target.value)}
              placeholder="MH12AB1234"
              required
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            Passenger seats (excluding you)
            <input
              type="number"
              min="1"
              max="8"
              value={seatCapacity}
              onChange={(e) => setSeatCapacity(e.target.value)}
              required
              className={inputClass}
            />
          </label>
        </div>
        <button
          type="submit"
          className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Add vehicle
        </button>
      </form>

      {isLoading && <p className="text-sm text-gray-500">Loading...</p>}
      {isError && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          Failed to load your vehicles.
        </p>
      )}
      {data && data.length === 0 && <p className="text-sm text-gray-500">You haven't added any vehicles yet.</p>}

      <ul className="space-y-3">
        {data?.map((v) => (
          <li key={v.id} className="rounded-xl bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="font-medium text-gray-900">
                {v.colour} {v.make} {v.model} · {v.plateNumber}
              </p>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${vehicleStatusBadgeClass[v.status]}`}>
                {v.status}
              </span>
            </div>
            <p className="mt-1 text-sm text-gray-500">{v.seatCapacity} passenger seats</p>
            {v.status === "PENDING" && v.documents.length < DOC_TYPES.length && (
              <p className="mt-1 text-sm text-yellow-700">Upload both documents so an admin can review this vehicle.</p>
            )}
            {v.status === "PENDING" && v.documents.length === DOC_TYPES.length && (
              <p className="mt-1 text-sm text-gray-500">Waiting for admin review.</p>
            )}
            {v.status === "REJECTED" && (
              <p className="mt-1 text-sm text-red-700">
                Rejected{v.rejectionNote ? `: ${v.rejectionNote}` : ""}. Re-upload a document to resubmit.
              </p>
            )}
            <ul className="mt-3 space-y-2 border-t border-gray-100 pt-3">
              {DOC_TYPES.map((type) => {
                const uploaded = v.documents.some((d) => d.type === type);
                const busy = busyKey === `${v.id}:${type}`;
                return (
                  <li key={type} className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="w-56 text-gray-700">{DOC_LABEL[type]}</span>
                    <span className={uploaded ? "text-green-700" : "text-gray-400"}>
                      {uploaded ? "Uploaded" : "Not uploaded"}
                    </span>
                    {uploaded && (
                      <button
                        type="button"
                        onClick={() => handleView(v.id, type)}
                        className="font-medium text-blue-600 hover:underline"
                      >
                        View
                      </button>
                    )}
                    <label className="cursor-pointer font-medium text-blue-600 hover:underline">
                      {busy ? "Uploading..." : uploaded ? "Replace" : "Upload"}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,application/pdf"
                        disabled={busy}
                        className="hidden"
                        onChange={(e) => {
                          void handleUpload(v.id, type, e.target.files?.[0]);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </li>
                );
              })}
            </ul>
            {v.status === "APPROVED" && (
              <p className="mt-2 text-xs text-gray-400">Replacing a document sends this vehicle back for review.</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 5: `web/src/components/Layout.tsx`** — after the "My rides" link block add:
```tsx
          {isDriver && (
            <Link to="/vehicles/mine" className="text-sm font-medium text-gray-600 hover:text-blue-600">
              My vehicles
            </Link>
          )}
```
and inside the `isAdmin` fragment, after "All rides":
```tsx
              <Link to="/admin/vehicles" className="text-sm font-medium text-gray-600 hover:text-blue-600">
                Vehicle review
              </Link>
```

- [ ] **Step 6: `web/src/main.tsx`** — add imports and routes:
```tsx
import { MyVehiclesPage } from "./pages/MyVehiclesPage";
import { AdminVehiclesPage } from "./pages/admin/AdminVehiclesPage";
```
```tsx
      { path: "/vehicles/mine", element: <MyVehiclesPage /> },
      { path: "/admin/vehicles", element: <AdminVehiclesPage /> },
```
(`AdminVehiclesPage` is created in Task 8; do Tasks 7 and 8 back to back before building.)

- [ ] **Step 7: Verify** (after Task 8 exists so the import resolves)
```bash
cd web && npm run build && npm test 2>&1 | tail -15
```
Expected: build passes; the web suite matches the Task 1 baseline (existing `Layout`, `api`, `MyRidesPage` tests untouched and passing — `Layout.test`'s `getByText("My rides")` is an exact match, so the new "My vehicles" link doesn't collide).

---

### Task 8: Frontend — ride forms, vehicle display, admin review page

**Files:**
- Create: `web/src/pages/admin/AdminVehiclesPage.tsx`
- Modify: `web/src/pages/PostRidePage.tsx`, `web/src/components/EditRideForm.tsx`, `web/src/pages/MyRidesPage.tsx`, `web/src/pages/MyBookingsPage.tsx`, `web/src/pages/admin/AdminRidesPage.tsx`

**Interfaces:**
- Consumes: Task 7's `VehicleSelect`, `formatVehicle`, `VehicleSummary`, `Vehicle`, `openDocument`, `vehicleStatusBadgeClass`, `DOC_LABEL`; API shapes from Tasks 3–5.

**Constraint:** `MyRidesPage.test.tsx` mocks `apiFetch` with positional `mockResolvedValueOnce` calls. Do **not** add any new `apiFetch`/`useQuery` call to `MyRidesPage`'s render path — only render fields already present in the `/api/rides/mine` response. (`VehicleSelect`'s query only mounts inside `EditRideForm`, which those tests never open.)

- [ ] **Step 1: `PostRidePage.tsx`**

Import: `import { VehicleSelect } from "../components/VehicleSelect";`. Add state: `const [vehicleId, setVehicleId] = useState("");`. In the request body add `...(vehicleId && { vehicleId }),` after `estimatedCost,`. In the JSX, immediately before the "Departure time" label add:
```tsx
        <label className={labelClass}>
          Vehicle
          <VehicleSelect
            value={vehicleId}
            onChange={setVehicleId}
            seatsNeeded={Number(totalSeats) || 1}
            className={inputClass}
          />
        </label>
```
Re-select the vehicle's validity is enforced server-side; if the seat count is raised above the chosen vehicle's capacity the option becomes disabled, so also clear a now-invalid choice: change the seats input's `onChange` to `(e) => { setTotalSeats(e.target.value); setVehicleId(""); }`.

- [ ] **Step 2: `EditRideForm.tsx`**

Extend the interface: in `EditableRide` add `vehicle?: { vehicleId: string } | null;`. Import `VehicleSelect`. Add state `const [vehicleId, setVehicleId] = useState(ride.vehicle?.vehicleId ?? "");`. Add `...(vehicleId && { vehicleId }),` to the PATCH body after `estimatedCost,`. Add, before the "Departure time" label:
```tsx
      <label className={labelClass}>
        Vehicle
        <VehicleSelect
          value={vehicleId}
          onChange={setVehicleId}
          seatsNeeded={Number(totalSeats) || 1}
          className={inputClass}
        />
      </label>
```
Note for the executor: a ride whose vehicle is no longer APPROVED (e.g. edited back to PENDING) shows an empty selection; the driver must pick an approved vehicle to save edits — this matches the server, which re-checks the vehicle on every `editRide`.

- [ ] **Step 3: `MyRidesPage.tsx`** — extend `MyRide` with `vehicle?: { vehicleId: string; make: string; model: string; colour: string; plate: string } | null;`, import `formatVehicle`, and in the ride `<li>` after the departure-time `<p>` add:
```tsx
            <p className="mt-1 text-sm text-gray-500">
              {ride.vehicle ? formatVehicle(ride.vehicle) : "Vehicle details not provided"}
            </p>
```

- [ ] **Step 4: `MyBookingsPage.tsx`** — extend `MyBooking` with `vehicle: VehicleSummary | null;` (import `formatVehicle`, `type VehicleSummary`), and after the `driverContact` block add:
```tsx
            {booking.vehicle && (
              <p className="mt-1 text-sm text-gray-500">Vehicle: {formatVehicle(booking.vehicle)}</p>
            )}
```

- [ ] **Step 5: `AdminRidesPage.tsx`** — add `vehicle?: VehicleSummary | null;` to `AdminRide`, a `<th className="px-4 py-3">Vehicle</th>` after "Driver", and a cell:
```tsx
                <td className="px-4 py-3 text-gray-600">{ride.vehicle ? formatVehicle(ride.vehicle) : "—"}</td>
```
(import `formatVehicle`, `type VehicleSummary` from `../../lib/vehicleTypes`).

- [ ] **Step 6: Create `web/src/pages/admin/AdminVehiclesPage.tsx`**
```tsx
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "../../lib/api";
import { DOC_LABEL, type DocType, type Vehicle, openDocument } from "../../lib/vehicleTypes";

type ReviewVehicle = Vehicle & { owner: { id: string; name: string; email: string } };

export function AdminVehiclesPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  // Per-vehicle rejection note being typed.
  const [notes, setNotes] = useState<Record<string, string>>({});

  const { data, isLoading, isError } = useQuery<ReviewVehicle[]>({
    queryKey: ["admin", "vehicles"],
    queryFn: () => apiFetch("/api/admin/vehicles?status=PENDING"),
  });

  const message = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong");

  async function review(vehicleId: string, decision: "APPROVED" | "REJECTED") {
    setError(null);
    try {
      await apiFetch(`/api/admin/vehicles/${vehicleId}/review`, {
        method: "PATCH",
        body: { decision, ...(decision === "REJECTED" && { note: notes[vehicleId] ?? "" }) },
      });
      await queryClient.refetchQueries({ queryKey: ["admin", "vehicles"] });
    } catch (err) {
      setError(message(err));
    }
  }

  async function view(vehicleId: string, type: DocType) {
    setError(null);
    try {
      await openDocument(apiFetch, vehicleId, type);
    } catch (err) {
      setError(message(err));
    }
  }

  if (isLoading) return <p className="text-sm text-gray-500">Loading...</p>;
  if (isError)
    return (
      <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
        Failed to load the review queue.
      </p>
    );

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">Vehicle review</h1>
      {error && (
        <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {data && data.length === 0 && <p className="text-sm text-gray-500">Nothing waiting for review.</p>}
      <ul className="space-y-3">
        {data?.map((v) => {
          const hasBoth = (["RC", "LICENCE"] as DocType[]).every((t) => v.documents.some((d) => d.type === t));
          return (
            <li key={v.id} className="rounded-xl bg-white p-4 shadow-sm">
              <p className="font-medium text-gray-900">
                {v.colour} {v.make} {v.model} · {v.plateNumber} · {v.seatCapacity} seats
              </p>
              <p className="mt-1 text-sm text-gray-500">
                Owner: {v.owner.name} ({v.owner.email}) · submitted {new Date(v.createdAt).toLocaleString()}
              </p>
              <p className="mt-1 text-xs text-gray-400">Check that the plate and name match the RC and licence.</p>
              <div className="mt-3 flex flex-wrap gap-4 text-sm">
                {(["RC", "LICENCE"] as DocType[]).map((type) =>
                  v.documents.some((d) => d.type === type) ? (
                    <button
                      key={type}
                      type="button"
                      onClick={() => view(v.id, type)}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      View {DOC_LABEL[type]}
                    </button>
                  ) : (
                    <span key={type} className="text-gray-400">
                      {DOC_LABEL[type]}: missing
                    </span>
                  ),
                )}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!hasBoth}
                  onClick={() => review(v.id, "APPROVED")}
                  className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  Approve
                </button>
                <input
                  value={notes[v.id] ?? ""}
                  onChange={(e) => setNotes((n) => ({ ...n, [v.id]: e.target.value }))}
                  placeholder="Reason (required to reject)"
                  maxLength={500}
                  className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                />
                <button
                  type="button"
                  disabled={!(notes[v.id] ?? "").trim()}
                  onClick={() => review(v.id, "REJECTED")}
                  className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```
The rejection note is rendered only as React text (escaped), never as HTML.

- [ ] **Step 7: Verify**

```bash
cd web && npm run build && npm test 2>&1 | tail -15
```
Expected: build passes; the web suite result matches the Task 1 baseline. Then in the browser (`npm run dev` for both; `docker compose up -d db rabbitmq mailpit redis minio`; seeded accounts, password `password123`):
1. Driver `kiran.driver@example.com` → "My vehicles": the Innova is Approved, the Nexon Pending with "Upload both documents". Upload a JPEG as RC and a PDF as Licence; a renamed `.txt` shows the 400 message; "View" opens the file.
2. Admin → "Vehicle review": the Nexon shows with both document links; Reject without a note is disabled; Reject with a note → disappears; as Kiran the Nexon shows Rejected + the reason; re-upload → Pending again; Approve → Approved.
3. Driver → "Post a ride": the Vehicle dropdown lists only approved vehicles; raising seats above a vehicle's capacity disables it; posting works; "My rides" shows the vehicle line.
4. Rider `rina.rider@example.com`: search results show **no** vehicle; book a Dara ride → "My bookings" shows the vehicle; cancel → the vehicle line disappears.
5. Driver editing a ride with no confirmed bookings can switch vehicle; with a confirmed booking the Edit save returns the existing 409.

- [ ] **Step 8 (only if commits were requested): Commit**
```bash
git add web
git commit -m "feat(web): vehicle management, vehicle picker on rides, admin vehicle review"
```

---

### Task 9: Documentation and final regression pass

**Files:** Modify `CLAUDE.md`

- [ ] **Step 1: Update `CLAUDE.md`**

(a) In the **Project** section's delivery-order sentence, append: "Vehicle verification (vehicles, RC/licence documents, admin review, vehicle linked to rides) is complete per [2026-10-14-vehicle-verification-design.md](docs/superpowers/specs/2026-10-14-vehicle-verification-design.md)."

(b) Add a new subsection after "### Admin module":
```markdown
### Vehicles and admin verification

`src/modules/vehicles/` (+ `GET/PATCH /api/admin/vehicles…`). A driver registers
`Vehicle`s (plate normalised; `plateKey` is the unique handle, NULL when
REJECTED so a rejected/squatted plate frees up), uploads an `RC` and `LICENCE`
`VehicleDocument` (multipart, JPEG/PNG/PDF by magic bytes, ≤ 5 MB), and an admin
approves/rejects. A ride is posted with a `vehicleId`; `createRide`/`editRide`
check inside their transaction that it is the caller's, `APPROVED`, and
`totalSeats <= seatCapacity`, then write a `RideVehicle` snapshot.

- **The snapshot is a separate table on purpose.** `searchRides`, `getMyRides`
  and the admin rides list call `ride.findMany` with no `select`, so any column
  on `Ride` would leak to every searcher and into the Redis cache. Nothing may
  `include: { vehicle }` in a query feeding `GET /api/rides/search`. Riders see
  the vehicle only via `GET /api/bookings/mine` for `CONFIRMED` bookings.
- **Lock order is Ride → Vehicle.** Every vehicle write (`lockVehicle`) takes
  `SELECT … FOR UPDATE` on the vehicle row first, then reads status; vehicle
  writes never lock a Ride or Booking, so no cycle with the Ride → Booking order.
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
  optional: without them the server boots and only the document endpoints 503.
- Seeded drivers have APPROVED vehicles; Kiran also has a PENDING one for the
  admin queue.
```

(c) In **Testing**, add one line: "- Exception: vehicle verification adds no automated tests (see 'Vehicles and admin verification'); `tests/integration/testDb.ts` needs no change because the new foreign keys cascade."

(d) In **Money and matching** or the search-cache section, add to "Adding a new write path": "Vehicle writes don't change search results, so they don't call `invalidateSearchCache`."

- [ ] **Step 2: Full regression**

```bash
npx tsc -p tsconfig.json --noEmit
npm test 2>&1 | tail -25
cd web && npm run build && npm test 2>&1 | tail -15
```
Expected: no type errors; both suites match the Task 1 baseline exactly (no new failures; no test file changed — confirm with `git status` that nothing under `tests/` or `web/src/**/*.test.*` is modified, and `tests/integration/testDb.ts` is untouched).

- [ ] **Step 3: End-to-end smoke (production-like flag)** — with the dev server running (flag defaulting to on), run the Task 3–5 manual flows once, in order, as a final pass: register driver → vehicle → docs → admin approve → post ride → rider search (no vehicle fields) → book → vehicle visible on the booking → cancel → vehicle hidden. Also `docker compose stop minio` and confirm `GET /api/rides/search` and `POST /api/rides` still work.

- [ ] **Step 4 (only if commits were requested): Commit**
```bash
git add CLAUDE.md docs
git commit -m "docs: document vehicle verification"
```

---

## Self-review (spec coverage)

- §3 data model, `plateKey`, cascades, `RideVehicle` → Task 1. §3.1 rules: plate (T2), resubmission/sensitive edits (T2, T4), capacity & posting & switching (T3), roles/self-review/approval (T5). §3.2 visibility table → T3 (search untouched, mine, bookings, admin). §3.3 locking → T2 `lockVehicle`, T3, T5.
- §4 endpoints: all seven → T2, T4, T5. §5 upload/storage hardening, `S3_PUBLIC_ENDPOINT`, 503 when unconfigured, attachment disposition, replace flow → T4. §6 review + email → T5. §7 seed → T6. §8 flag + test config + untouched `testDb.ts` → T1. §9 rollout order matches. §10 register rows 1–19 are each covered by a task or a manual check (rows 2/3 T1; 1 T3; 4 T6; 5/6 T2/T4; 7 T3; 8/9 T5; 10/11/12/13 T4; 14/15/16/18 T3; 17 T1; 19 T7).
- Type consistency: `lockVehicle`, `vehicleView`, `DOC_SELECT`, `isPlateClash`, `assertVehicleCanServeRide`, `uploadDocument`, `getDocumentUrl`, `listVehiclesForReview`, `reviewVehicle`, `notifyVehicleReviewed`, `VEHICLE_REVIEWED` are defined once and used with the same signatures; the frontend `VehicleSummary` matches the booking/ride JSON (`plate`, not `plateNumber`), while the live `Vehicle` uses `plateNumber`.
