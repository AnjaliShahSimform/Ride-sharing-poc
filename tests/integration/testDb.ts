import { prisma } from "../../src/lib/prisma";

// Every integration test file shares one real database (vitest.config.ts's
// fileParallelism: false), so cleanup must be shared too — children before
// parents, respecting FK order. Extend this when a new table gets a FK.
export async function resetDb() {
  await prisma.booking.deleteMany();
  await prisma.ride.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();
}
