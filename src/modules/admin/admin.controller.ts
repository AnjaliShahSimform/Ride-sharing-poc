import type { Request, Response } from "express";
import * as adminService from "./admin.service";
import type { AdminRidesQuery, AdminUsersQuery, AuditLogQuery } from "./admin.schemas";

export async function getAllUsersHandler(req: Request, res: Response) {
  const users = await adminService.getAllUsers(req.query as unknown as AdminUsersQuery);
  res.status(200).json(users);
}

export async function getAllRidesHandler(req: Request, res: Response) {
  const rides = await adminService.getAllRides(req.query as unknown as AdminRidesQuery);
  res.status(200).json(rides);
}

export async function getAuditLogsHandler(req: Request, res: Response) {
  const result = await adminService.getAuditLogs(req.query as unknown as AuditLogQuery);
  res.status(200).json(result);
}
