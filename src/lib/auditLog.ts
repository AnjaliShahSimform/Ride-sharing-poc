import type { Prisma } from "@prisma/client";

export async function writeAuditLog(
  tx: Prisma.TransactionClient,
  entityType: "Ride" | "Booking",
  entityId: string,
  action: string,
  actorId: string,
  metadata?: Record<string, unknown>,
) {
  await tx.auditLog.create({
    data: { entityType, entityId, action, actorId, metadata: metadata as Prisma.InputJsonValue },
  });
}
