import { RideStatus } from "@prisma/client";
import { ConflictError, ForbiddenError, NotFoundError } from "../../lib/AppError";
import { prisma } from "../../lib/prisma";
import type { CreateRideInput, SearchRidesQuery } from "./rides.schemas";

// Rough km-per-degree-latitude; degrees-of-longitude shrink toward the poles,
// so longitude deltas are scaled by cos(latitude). Good enough for a bounding
// box at POC scale — see design spec §4 for the PostGIS upgrade path.
const KM_PER_DEGREE_LAT = 111;

export async function createRide(driverId: string, input: CreateRideInput) {
  return prisma.ride.create({
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
  const ride = await prisma.ride.findUnique({ where: { id: rideId } });
  if (!ride) {
    throw new NotFoundError("Ride not found");
  }
  if (ride.driverId !== driverId) {
    throw new ForbiddenError("Only the driver who posted this ride can modify it");
  }
  if (ride.status !== RideStatus.SCHEDULED) {
    throw new ConflictError(`Ride is already ${ride.status.toLowerCase()}`);
  }

  return prisma.ride.update({ where: { id: rideId }, data: { status: toStatus } });
}

export function cancelRide(driverId: string, rideId: string) {
  return transitionRide(driverId, rideId, RideStatus.CANCELLED);
}

export function completeRide(driverId: string, rideId: string) {
  return transitionRide(driverId, rideId, RideStatus.COMPLETED);
}
