-- CreateEnum
CREATE TYPE "RideStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Ride" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "originLat" DOUBLE PRECISION NOT NULL,
    "originLng" DOUBLE PRECISION NOT NULL,
    "destLat" DOUBLE PRECISION NOT NULL,
    "destLng" DOUBLE PRECISION NOT NULL,
    "originLabel" TEXT NOT NULL,
    "destLabel" TEXT NOT NULL,
    "departureTime" TIMESTAMP(3) NOT NULL,
    "totalSeats" INTEGER NOT NULL,
    "seatsAvailable" INTEGER NOT NULL,
    "estimatedCost" DECIMAL(10,2) NOT NULL,
    "status" "RideStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Ride_departureTime_idx" ON "Ride"("departureTime");

-- CreateIndex
CREATE INDEX "Ride_originLat_originLng_idx" ON "Ride"("originLat", "originLng");

-- CreateIndex
CREATE INDEX "Ride_destLat_destLng_idx" ON "Ride"("destLat", "destLng");

-- AddForeignKey
ALTER TABLE "Ride" ADD CONSTRAINT "Ride_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
