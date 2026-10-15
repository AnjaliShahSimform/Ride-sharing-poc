import type { Prisma } from "@prisma/client";
import { istDayEndExclusive, istDayStart } from "../../lib/rideTime";
import { prisma } from "../../lib/prisma";
import type { AdminRidesQuery, AdminUsersQuery, AuditLogQuery } from "./admin.schemas";

// Every admin list returns this envelope, so the frontend has one pager.
export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// Inclusive IST-day range -> Prisma DateTime filter; undefined when neither end is set.
function istDayRange(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  return {
    ...(from && { gte: istDayStart(from) }),
    ...(to && { lt: istDayEndExclusive(to) }),
  };
}

const contains = (value: string) => ({ contains: value, mode: "insensitive" as const });

export async function getAllUsers(query: AdminUsersQuery): Promise<Paged<unknown>> {
  const { page, pageSize, role, q, joinedFrom, joinedTo } = query;
  const where: Prisma.UserWhereInput = {
    ...(role && { roles: { has: role } }),
    ...(q && { OR: [{ name: contains(q) }, { email: contains(q) }, { phone: contains(q) }] }),
    createdAt: istDayRange(joinedFrom, joinedTo),
  };
  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      // id breaks ties so rows created in the same instant never straddle pages.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, name: true, email: true, phone: true, roles: true, createdAt: true },
    }),
    prisma.user.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function getAllRides(query: AdminRidesQuery): Promise<Paged<unknown>> {
  const { page, pageSize, status, q, departureFrom, departureTo } = query;
  const where: Prisma.RideWhereInput = {
    ...(status && { status }),
    ...(q && {
      OR: [
        { originLabel: contains(q) },
        { destLabel: contains(q) },
        { driver: { name: contains(q) } },
        { driver: { email: contains(q) } },
      ],
    }),
    departureTime: istDayRange(departureFrom, departureTo),
  };
  const [items, total] = await Promise.all([
    prisma.ride.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { driver: { select: { id: true, name: true, email: true } }, vehicle: true },
    }),
    prisma.ride.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function getAuditLogs(query: AuditLogQuery): Promise<Paged<unknown>> {
  const { page, pageSize, entityType, action, from, to } = query;
  const where: Prisma.AuditLogWhereInput = {
    ...(entityType && { entityType }),
    ...(action && { action }),
    createdAt: istDayRange(from, to),
  };
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { items, total, page, pageSize };
}
