import type { Request, Response } from "express";
import * as vehiclesService from "./vehicles.service";

export async function createVehicleHandler(req: Request, res: Response) {
  const vehicle = await vehiclesService.createVehicle(req.user!.sub, req.body);
  res.status(201).json(vehicle);
}

export async function getMyVehiclesHandler(req: Request, res: Response) {
  const vehicles = await vehiclesService.getMyVehicles(req.user!.sub);
  res.status(200).json(vehicles);
}

export async function updateVehicleHandler(req: Request, res: Response) {
  const vehicle = await vehiclesService.updateVehicle(req.user!.sub, req.params.id, req.body);
  res.status(200).json(vehicle);
}
