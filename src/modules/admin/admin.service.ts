import { prisma } from "../../lib/prisma";
import type { AuditLogQuery } from "./admin.schemas";

export async function getAllUsers() {
  return prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, email: true, phone: true, roles: true, createdAt: true },
  });
}

export async function getAllRides() {
  return prisma.ride.findMany({
    orderBy: { createdAt: "desc" },
    include: { driver: { select: { id: true, name: true, email: true } } },
  });
}

export async function getAuditLogs(query: AuditLogQuery) {
  const { page, pageSize } = query;
  const [entries, total] = await Promise.all([
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count(),
  ]);
  return { entries, total, page, pageSize };
}
