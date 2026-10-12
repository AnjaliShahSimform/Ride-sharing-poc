import type { Prisma, Ride, User } from "@prisma/client";
import { enqueueEmail } from "../../lib/outbox";
import type { RideSummary } from "./templates";

// The only place that decides WHO gets WHICH email. Each function runs inside
// the caller's transaction (it only writes OutboxEvent rows via enqueueEmail),
// so the service's change and its emails commit or roll back together.
// Contact details (name/phone) go only to the other party of a CONFIRMED
// booking, and every email goes only to that user's own address.

function rideSummary(ride: Pick<Ride, "originLabel" | "destLabel" | "departureTime">): RideSummary {
  return {
    originLabel: ride.originLabel,
    destLabel: ride.destLabel,
    departureTime: ride.departureTime.toISOString(),
  };
}

export async function notifyBookingCreated(
  tx: Prisma.TransactionClient,
  args: { ride: Ride; driver: User; rider: User; costShare: Prisma.Decimal; seatsAvailable: number },
) {
  const { ride, driver, rider } = args;
  await enqueueEmail(tx, "BOOKING_CONFIRMED", rider.email, {
    riderName: rider.name,
    driverName: driver.name,
    driverPhone: driver.phone,
    costShare: args.costShare.toString(),
    ride: rideSummary(ride),
  });
  await enqueueEmail(tx, "BOOKING_RECEIVED", driver.email, {
    driverName: driver.name,
    riderName: rider.name,
    riderPhone: rider.phone,
    seatsAvailable: args.seatsAvailable,
    ride: rideSummary(ride),
  });
}

// Tells whichever party did NOT cancel.
export async function notifyBookingCancelled(
  tx: Prisma.TransactionClient,
  args: { ride: Ride; driver: User; rider: User; cancelledBy: "RIDER" | "DRIVER" },
) {
  const { ride, driver, rider, cancelledBy } = args;
  const recipient = cancelledBy === "RIDER" ? driver : rider;
  const other = cancelledBy === "RIDER" ? rider : driver;
  await enqueueEmail(tx, "BOOKING_CANCELLED", recipient.email, {
    recipientName: recipient.name,
    otherName: other.name,
    cancelledBy,
    ride: rideSummary(ride),
  });
}

export async function notifyRideTransition(
  tx: Prisma.TransactionClient,
  args: { template: "RIDE_CANCELLED" | "RIDE_COMPLETED"; ride: Ride; driver: User; riders: User[] },
) {
  for (const rider of args.riders) {
    await enqueueEmail(tx, args.template, rider.email, {
      riderName: rider.name,
      driverName: args.driver.name,
      ride: rideSummary(args.ride),
    });
  }
}
