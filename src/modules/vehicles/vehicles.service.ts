import { Prisma, VehicleStatus } from "@prisma/client";
import type { DocType, Vehicle } from "@prisma/client";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../lib/AppError";
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
