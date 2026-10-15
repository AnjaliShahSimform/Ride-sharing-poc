-- A rider holds at most one CONFIRMED booking per ride. Partial, so a cancelled
-- booking doesn't block booking the same ride again. Prisma can't express a
-- partial unique index in schema.prisma; this is the only place it is declared.
CREATE UNIQUE INDEX "Booking_rideId_riderId_confirmed_key"
  ON "Booking" ("rideId", "riderId")
  WHERE "status" = 'CONFIRMED';
