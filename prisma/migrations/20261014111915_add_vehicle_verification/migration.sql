-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DocType" AS ENUM ('RC', 'LICENCE');

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "colour" TEXT NOT NULL,
    "plateNumber" TEXT NOT NULL,
    "plateKey" TEXT,
    "seatCapacity" INTEGER NOT NULL,
    "status" "VehicleStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleDocument" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "type" "DocType" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RideVehicle" (
    "rideId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "colour" TEXT NOT NULL,
    "plate" TEXT NOT NULL,

    CONSTRAINT "RideVehicle_pkey" PRIMARY KEY ("rideId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_plateKey_key" ON "Vehicle"("plateKey");

-- CreateIndex
CREATE INDEX "Vehicle_ownerId_idx" ON "Vehicle"("ownerId");

-- CreateIndex
CREATE INDEX "Vehicle_status_createdAt_idx" ON "Vehicle"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleDocument_vehicleId_type_key" ON "VehicleDocument"("vehicleId", "type");

-- CreateIndex
CREATE INDEX "RideVehicle_vehicleId_idx" ON "RideVehicle"("vehicleId");

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleDocument" ADD CONSTRAINT "VehicleDocument_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideVehicle" ADD CONSTRAINT "RideVehicle_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideVehicle" ADD CONSTRAINT "RideVehicle_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
