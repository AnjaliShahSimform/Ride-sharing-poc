import { BookingStatus, Prisma } from "@prisma/client";
import { ConflictError, NotFoundError } from "../../lib/AppError";
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
