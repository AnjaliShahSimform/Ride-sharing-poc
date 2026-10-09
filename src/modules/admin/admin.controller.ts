import type { Request, Response } from "express";
import * as adminService from "./admin.service";
import type { AuditLogQuery } from "./admin.schemas";

export async function getAllUsersHandler(_req: Request, res: Response) {
  const users = await adminService.getAllUsers();
  res.status(200).json(users);
}

export async function getAllRidesHandler(_req: Request, res: Response) {
  const rides = await adminService.getAllRides();
  res.status(200).json(rides);
}

export async function getAuditLogsHandler(req: Request, res: Response) {
  const result = await adminService.getAuditLogs(req.query as unknown as AuditLogQuery);
  res.status(200).json(result);
}
