import { BookingStatus, RideStatus } from "@prisma/client";
import { ConflictError, ForbiddenError, NotFoundError } from "../../lib/AppError";
import { writeAuditLog } from "../../lib/auditLog";
import { prisma } from "../../lib/prisma";
import type { CreateRideInput, SearchRidesQuery } from "./rides.schemas";

// Rough km-per-degree-latitude; degrees-of-longitude shrink toward the poles,
// so longitude deltas are scaled by cos(latitude). Good enough for a bounding
// box at POC scale — see design spec §4 for the PostGIS upgrade path.
const KM_PER_DEGREE_LAT = 111;

export async function createRide(driverId: string, input: CreateRideInput) {
  return prisma.$transaction(async (tx) => {
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
    await writeAuditLog(tx, "Ride", ride.id, "CREATED", driverId);
    return ride;
  });
}

export async function searchRides(query: SearchRidesQuery) {
  const { originLat, originLng, destLat, destLng, earliestDeparture, latestDeparture, radiusKm } = query;

  const latDelta = radiusKm / KM_PER_DEGREE_LAT;
  const originLngDelta = radiusKm / (KM_PER_DEGREE_LAT * Math.cos((originLat * Math.PI) / 180));
  const destLngDelta = radiusKm / (KM_PER_DEGREE_LAT * Math.cos((destLat * Math.PI) / 180));

  // Bounding box on origin AND destination, ANDed with an indexed time-window
  // overlap — an index range scan, not an in-memory filter (design spec §4).
  return prisma.ride.findMany({
    where: {
      status: "SCHEDULED",
      seatsAvailable: { gt: 0 },
      departureTime: { gte: earliestDeparture, lte: latestDeparture },
      originLat: { gte: originLat - latDelta, lte: originLat + latDelta },
      originLng: { gte: originLng - originLngDelta, lte: originLng + originLngDelta },
      destLat: { gte: destLat - latDelta, lte: destLat + latDelta },
      destLng: { gte: destLng - destLngDelta, lte: destLng + destLngDelta },
    },
    orderBy: { departureTime: "asc" },
  });
}

export async function getMyRides(driverId: string) {
  return prisma.ride.findMany({
    where: { driverId },
    orderBy: { createdAt: "desc" },
  });
}

// Ownership check (this specific record) lives here, in the service layer —
// distinct from the requireRole RBAC middleware (this route at all). Only a
// SCHEDULED ride can transition; once CANCELLED or COMPLETED it's locked, per
// design spec §6.
async function transitionRide(driverId: string, rideId: string, toStatus: RideStatus) {
  return prisma.$transaction(async (tx) => {
    const ride = await tx.ride.findUnique({ where: { id: rideId } });
    if (!ride) {
      throw new NotFoundError("Ride not found");
    }
    if (ride.driverId !== driverId) {
      throw new ForbiddenError("Only the driver who posted this ride can modify it");
    }
    if (ride.status !== RideStatus.SCHEDULED) {
      throw new ConflictError(`Ride is already ${ride.status.toLowerCase()}`);
    }

    // Conditional UPDATE, not a plain update: re-checks status under the same
    // row lock that performs the write, so two concurrent transitions on the
    // same ride (e.g. cancel racing complete from two tabs) can't both pass
    // the earlier unlocked read above and both proceed. Mirrors the fix
    // applied to bookSeat/cancelBooking (see commits fa38549, 6176142).
    const result = await tx.ride.updateMany({
      where: { id: rideId, status: RideStatus.SCHEDULED },
      data: { status: toStatus },
    });
    if (result.count === 0) {
      // The pre-check above confirmed `ride.status` was SCHEDULED just before
      // this write — a race changed it in between, so re-fetch rather than
      // report the now-stale "scheduled" status back in the error message.
      const current = await tx.ride.findUniqueOrThrow({ where: { id: rideId } });
      throw new ConflictError(`Ride is already ${current.status.toLowerCase()}`);
    }
    const updated = await tx.ride.findUniqueOrThrow({ where: { id: rideId } });

    if (toStatus === RideStatus.CANCELLED) {
      const cascaded = await tx.booking.findMany({ where: { rideId, status: BookingStatus.CONFIRMED } });
      if (cascaded.length > 0) {
        await tx.booking.updateMany({
          where: { rideId, status: BookingStatus.CONFIRMED },
          data: { status: BookingStatus.CANCELLED, cancelledAt: new Date() },
        });
      }
      await writeAuditLog(tx, "Ride", rideId, "CANCELLED", driverId, {
        cascadedBookingIds: cascaded.map((b) => b.id),
      });
    } else {
      await writeAuditLog(tx, "Ride", rideId, toStatus, driverId);
    }

    return updated;
  });
}

export function cancelRide(driverId: string, rideId: string) {
  return transitionRide(driverId, rideId, RideStatus.CANCELLED);
}

export function completeRide(driverId: string, rideId: string) {
  return transitionRide(driverId, rideId, RideStatus.COMPLETED);
}
