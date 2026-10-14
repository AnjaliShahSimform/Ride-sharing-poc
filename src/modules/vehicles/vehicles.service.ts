import { randomUUID } from "node:crypto";
import { Prisma, VehicleStatus } from "@prisma/client";
import type { DocType, Vehicle } from "@prisma/client";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../lib/AppError";
import { writeAuditLog } from "../../lib/auditLog";
import { sniffDocumentType } from "../../lib/fileType";
import { prisma } from "../../lib/prisma";
import * as storage from "../../lib/storage";
import { notifyVehicleReviewed } from "../notifications/notify";
import type { CreateVehicleInput, ReviewVehicleInput, UpdateVehicleInput } from "./vehicles.schemas";

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
