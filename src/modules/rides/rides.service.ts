import { BookingStatus, RideStatus } from "@prisma/client";
import { env } from "../../config/env";
import { ConflictError, ForbiddenError, NotFoundError } from "../../lib/AppError";
import { writeAuditLog } from "../../lib/auditLog";
import { prisma } from "../../lib/prisma";
import { hasDeparted, isCancellationWindowClosed } from "../../lib/rideTime";
import { invalidateSearchCache, invalidateSearchCacheAfter, withSearchCache } from "../../lib/searchCache";
import { notifyRideTransition } from "../notifications/notify";
import { assertVehicleCanServeRide } from "../vehicles/vehicles.service";
import type { CreateRideInput, SearchRidesQuery } from "./rides.schemas";

// Rough km-per-degree-latitude; degrees-of-longitude shrink toward the poles,
// so longitude deltas are scaled by cos(latitude). Good enough for a bounding
// box at POC scale — see design spec §4 for the PostGIS upgrade path.
const KM_PER_DEGREE_LAT = 111;

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

async function createRideTransaction(driverId: string, input: CreateRideInput) {
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
}

export function createRide(driverId: string, input: CreateRideInput) {
  return invalidateSearchCacheAfter(createRideTransaction(driverId, input));
}

export function searchRides(query: SearchRidesQuery) {
  // Redis-cached, invalidated by every write that can change a result (see
  // lib/searchCache.ts). Every field the result depends on is in the key.
  const key = [
    query.originLat,
    query.originLng,
    query.destLat,
    query.destLng,
    query.earliestDeparture.toISOString(),
    query.latestDeparture.toISOString(),
    query.radiusKm,
  ].join(",");
  return withSearchCache(key, () => findMatchingRides(query));
}

async function findMatchingRides(query: SearchRidesQuery) {
  const { originLat, originLng, destLat, destLng, earliestDeparture, latestDeparture, radiusKm } = query;

  const latDelta = radiusKm / KM_PER_DEGREE_LAT;
  const originLngDelta = radiusKm / (KM_PER_DEGREE_LAT * Math.cos((originLat * Math.PI) / 180));
  const destLngDelta = radiusKm / (KM_PER_DEGREE_LAT * Math.cos((destLat * Math.PI) / 180));

  // Bounding box on origin AND destination, ANDed with an indexed time-window
  // overlap — an index range scan, not an in-memory filter (design spec §4).
  // No `include`/`select` on purpose: vehicle data lives in RideVehicle and must
  // never reach search results (or the Redis cache that stores them).
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
    include: { vehicle: true },
    orderBy: { createdAt: "desc" },
  });
}

// Editing is blocked once any CONFIRMED booking exists — a rider who already
// has a seat shouldn't have the route/time silently change under them. The
// driver's only path then is cancel (which cascades their bookings) + repost.
//
// Same race class as bookSeat/transitionRide: a concurrent booking could slip
// in between an unlocked "any confirmed bookings?" read and the write. Closed
// the same way — the conditional updateMany takes the Ride row lock *before*
// the confirmed-booking check, so a concurrent bookSeat blocks on this row
// until this transaction commits or rolls back, instead of racing it.
async function editRideTransaction(driverId: string, rideId: string, input: CreateRideInput) {
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

    const result = await tx.ride.updateMany({
      where: { id: rideId, status: RideStatus.SCHEDULED },
      data: {
        originLat: input.originLat,
        originLng: input.originLng,
        destLat: input.destLat,
        destLng: input.destLng,
        originLabel: input.originLabel,
        destLabel: input.destLabel,
        departureTime: input.departureTime,
        totalSeats: input.totalSeats,
        // Safe to reset outright: if a confirmed booking turns up below, this
        // whole transaction — including this write — rolls back.
        seatsAvailable: input.totalSeats,
        estimatedCost: input.estimatedCost,
      },
    });
    if (result.count === 0) {
      const current = await tx.ride.findUniqueOrThrow({ where: { id: rideId } });
      throw new ConflictError(`Ride is already ${current.status.toLowerCase()}`);
    }

    const confirmedCount = await tx.booking.count({ where: { rideId, status: BookingStatus.CONFIRMED } });
    if (confirmedCount > 0) {
      throw new ConflictError("Cannot edit a ride with confirmed bookings — cancel and repost instead");
    }

    if (input.vehicleId) {
      const vehicle = await assertVehicleCanServeRide(tx, driverId, input.vehicleId, input.totalSeats);
      const snapshot = vehicleSnapshot(vehicle);
      await tx.rideVehicle.upsert({
        where: { rideId },
        create: { rideId, ...snapshot },
        update: snapshot,
      });
    }

    const updated = await tx.ride.findUniqueOrThrow({ where: { id: rideId } });
    await writeAuditLog(tx, "Ride", rideId, "UPDATED", driverId, input.vehicleId ? { vehicleId: input.vehicleId } : undefined);
    return updated;
  });
}

export function editRide(driverId: string, rideId: string, input: CreateRideInput) {
  return invalidateSearchCacheAfter(editRideTransaction(driverId, rideId, input));
}

// Ownership check (this specific record) lives here, in the service layer —
// distinct from the requireRole RBAC middleware (this route at all). Only a
// SCHEDULED ride can transition; once CANCELLED or COMPLETED it's locked, per
// design spec §6.
async function transitionRide(driverId: string, rideId: string, toStatus: RideStatus) {
  return prisma.$transaction(async (tx) => {
    const ride = await tx.ride.findUnique({ where: { id: rideId }, include: { driver: true } });
    if (!ride) {
      throw new NotFoundError("Ride not found");
    }
    if (ride.driverId !== driverId) {
      throw new ForbiddenError("Only the driver who posted this ride can modify it");
    }
    if (ride.status !== RideStatus.SCHEDULED) {
      throw new ConflictError(`Ride is already ${ride.status.toLowerCase()}`);
    }
    // Time rules. Checked against the row just read; a concurrent editRide
    // can't move departureTime on a ride that has confirmed bookings, and the
    // conditional UPDATE below still guards the status race.
    if (toStatus === RideStatus.CANCELLED && isCancellationWindowClosed(ride.departureTime)) {
      throw new ConflictError("A ride can't be cancelled on or after its day of departure");
    }
    if (toStatus === RideStatus.COMPLETED && !hasDeparted(ride.departureTime)) {
      throw new ConflictError("A ride can only be completed after it has departed");
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
      const cascaded = await tx.booking.findMany({
        where: { rideId, status: BookingStatus.CONFIRMED },
        include: { rider: true },
      });
      if (cascaded.length > 0) {
        await tx.booking.updateMany({
          where: { rideId, status: BookingStatus.CONFIRMED },
          data: { status: BookingStatus.CANCELLED, cancelledAt: new Date() },
        });
      }
      await writeAuditLog(tx, "Ride", rideId, "CANCELLED", driverId, {
        cascadedBookingIds: cascaded.map((b) => b.id),
      });
      await notifyRideTransition(tx, {
        template: "RIDE_CANCELLED",
        ride,
        driver: ride.driver,
        riders: cascaded.map((b) => b.rider),
      });
    } else {
      await writeAuditLog(tx, "Ride", rideId, toStatus, driverId);
      const confirmed = await tx.booking.findMany({
        where: { rideId, status: BookingStatus.CONFIRMED },
        include: { rider: true },
      });
      await notifyRideTransition(tx, {
        template: "RIDE_COMPLETED",
        ride,
        driver: ride.driver,
        riders: confirmed.map((b) => b.rider),
      });
    }

    return updated;
  });
}

export function cancelRide(driverId: string, rideId: string) {
  return invalidateSearchCacheAfter(transitionRide(driverId, rideId, RideStatus.CANCELLED));
}

export function completeRide(driverId: string, rideId: string) {
  return invalidateSearchCacheAfter(transitionRide(driverId, rideId, RideStatus.COMPLETED));
}

const EXPIRY_BATCH_SIZE = 200;

// Closes out rides that departed more than AUTO_COMPLETE_AFTER_HOURS ago and
// are still SCHEDULED (rides have no end time, so "long enough ago" stands in
// for "it's over"). Run periodically by the background job; safe to run on
// several instances at once and to re-run — it only ever touches rides that are
// still SCHEDULED when it locks them.
//   - had confirmed riders -> COMPLETED, riders get the usual completion email
//   - nobody booked        -> CANCELLED, audited as an expiry, no email
// Returns how many rides it closed. Handles at most EXPIRY_BATCH_SIZE per call;
// the next tick picks up the rest.
export async function closeExpiredRides(now: Date = new Date()) {
  const cutoff = new Date(now.getTime() - env.AUTO_COMPLETE_AFTER_HOURS * 60 * 60 * 1000);
  const candidates = await prisma.ride.findMany({
    where: { status: RideStatus.SCHEDULED, departureTime: { lt: cutoff } },
    select: { id: true },
    orderBy: { departureTime: "asc" },
    take: EXPIRY_BATCH_SIZE,
  });

  let closed = 0;
  for (const { id } of candidates) {
    const didClose = await prisma.$transaction(async (tx) => {
      // Take the Ride row lock first (Ride before Booking, like every other
      // path) and re-check the conditions under it. SKIP LOCKED: if another
      // instance — or a driver's manual cancel/complete — holds this ride right
      // now, leave it; it's either being closed already or will show up as no
      // longer SCHEDULED next tick.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Ride"
        WHERE "id" = ${id} AND "status" = 'SCHEDULED' AND "departureTime" < ${cutoff}
        FOR UPDATE SKIP LOCKED`;
      if (locked.length === 0) {
        return false;
      }

      const ride = await tx.ride.findUniqueOrThrow({ where: { id }, include: { driver: true } });
      const confirmed = await tx.booking.findMany({
        where: { rideId: id, status: BookingStatus.CONFIRMED },
        include: { rider: true },
      });

      if (confirmed.length > 0) {
        await tx.ride.update({ where: { id }, data: { status: RideStatus.COMPLETED } });
        await writeAuditLog(tx, "Ride", id, RideStatus.COMPLETED, "system", { reason: "AUTO_COMPLETED" });
        await notifyRideTransition(tx, {
          template: "RIDE_COMPLETED",
          ride,
          driver: ride.driver,
          riders: confirmed.map((b) => b.rider),
        });
      } else {
        await tx.ride.update({ where: { id }, data: { status: RideStatus.CANCELLED } });
        await writeAuditLog(tx, "Ride", id, "CANCELLED", "system", { reason: "EXPIRED_NO_BOOKINGS" });
      }
      return true;
    });
    if (didClose) {
      closed += 1;
    }
  }

  if (closed > 0) {
    await invalidateSearchCache();
  }
  return closed;
}
