import { BookingStatus, Prisma } from "@prisma/client";
import { ConflictError, ForbiddenError, NotFoundError } from "../../lib/AppError";
import { writeAuditLog } from "../../lib/auditLog";
import { prisma } from "../../lib/prisma";

function splitCost(totalCost: Prisma.Decimal, confirmedCount: number): Prisma.Decimal {
  return totalCost.dividedBy(confirmedCount).toDecimalPlaces(2);
}

// Recomputes and persists every CONFIRMED booking's share for this ride, and
// writes one audit entry listing the new shares. Called after any change to
// the confirmed-booking count (a new booking, or a cancellation). Returns the
// new share value, or undefined if there are no confirmed bookings left.
export async function recalculateShares(tx: Prisma.TransactionClient, rideId: string, totalCost: Prisma.Decimal) {
  const confirmed = await tx.booking.findMany({ where: { rideId, status: BookingStatus.CONFIRMED } });
  if (confirmed.length === 0) {
    return undefined;
  }

  const share = splitCost(totalCost, confirmed.length);
  await tx.booking.updateMany({
    where: { rideId, status: BookingStatus.CONFIRMED },
    data: { costShare: share },
  });
  await writeAuditLog(tx, "Ride", rideId, "COST_RECALCULATED", "system", {
    shares: confirmed.map((b) => ({ bookingId: b.id, costShare: share.toString() })),
  });

  return share;
}

// The single most important function in this module: two concurrent calls
// for the same ride's last seat must result in exactly one CONFIRMED
// booking. See design spec §5 for why the conditional UPDATE is race-safe
// without an explicit lock statement.
export async function bookSeat(rideId: string, riderId: string) {
  return prisma.$transaction(async (tx) => {
    const ride = await tx.ride.findUnique({ where: { id: rideId } });
    if (!ride) {
      throw new NotFoundError("Ride not found");
    }
    if (ride.status !== "SCHEDULED") {
      throw new ConflictError("This ride is not open for booking");
    }

    const result = await tx.ride.updateMany({
      where: { id: rideId, status: "SCHEDULED", seatsAvailable: { gt: 0 } },
      data: { seatsAvailable: { decrement: 1 } },
    });
    if (result.count === 0) {
      throw new ConflictError("No seats available");
    }

    const booking = await tx.booking.create({
      data: { rideId, riderId, status: BookingStatus.CONFIRMED, costShare: ride.estimatedCost },
    });

    // Recompute every confirmed booking's share, including this new one —
    // the row `tx.booking.create` returned above still holds the
    // placeholder costShare, so patch it with the real, recalculated value
    // before returning.
    const share = await recalculateShares(tx, rideId, ride.estimatedCost);

    await writeAuditLog(tx, "Booking", booking.id, "CREATED", riderId, { rideId });

    return share ? { ...booking, costShare: share } : booking;
  });
}

export async function cancelBooking(actorId: string, bookingId: string) {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: bookingId }, include: { ride: true } });
    if (!booking) {
      throw new NotFoundError("Booking not found");
    }
    if (booking.riderId !== actorId && booking.ride.driverId !== actorId) {
      throw new ForbiddenError("Only the rider or the ride's driver can cancel this booking");
    }
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new ConflictError("Booking is already cancelled");
    }

    const cancelled = await tx.booking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.CANCELLED, cancelledAt: new Date() },
    });

    await tx.ride.update({
      where: { id: booking.rideId },
      data: { seatsAvailable: { increment: 1 } },
    });

    await recalculateShares(tx, booking.rideId, booking.ride.estimatedCost);
    await writeAuditLog(tx, "Booking", bookingId, "CANCELLED", actorId, { rideId: booking.rideId });

    return cancelled;
  });
}

export async function getMyBookings(riderId: string) {
  const bookings = await prisma.booking.findMany({
    where: { riderId },
    include: { ride: { include: { driver: true } } },
    orderBy: { createdAt: "desc" },
  });

  return bookings.map((b) => ({
    id: b.id,
    rideId: b.rideId,
    status: b.status,
    costShare: b.costShare,
    createdAt: b.createdAt,
    ride: {
      originLabel: b.ride.originLabel,
      destLabel: b.ride.destLabel,
      departureTime: b.ride.departureTime,
      status: b.ride.status,
    },
    driverContact:
      b.status === BookingStatus.CONFIRMED ? { name: b.ride.driver.name, phone: b.ride.driver.phone } : null,
  }));
}

export async function getRideBookings(driverId: string, rideId: string) {
  const ride = await prisma.ride.findUnique({ where: { id: rideId } });
  if (!ride) {
    throw new NotFoundError("Ride not found");
  }
  if (ride.driverId !== driverId) {
    throw new ForbiddenError("Only the driver who posted this ride can view its bookings");
  }

  const bookings = await prisma.booking.findMany({
    where: { rideId },
    include: { rider: true },
    orderBy: { createdAt: "desc" },
  });

  return bookings.map((b) => ({
    id: b.id,
    status: b.status,
    costShare: b.costShare,
    createdAt: b.createdAt,
    riderContact: b.status === BookingStatus.CONFIRMED ? { name: b.rider.name, phone: b.rider.phone } : null,
  }));
}
