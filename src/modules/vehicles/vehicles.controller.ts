import type { Request, Response } from "express";
import { docTypeSchema } from "./vehicles.schemas";
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

export async function uploadDocumentHandler(req: Request, res: Response) {
  // `type` arrives as a multipart text field; parse() throws a ZodError -> 400.
  const type = docTypeSchema.parse(req.body?.type);
  const vehicle = await vehiclesService.uploadDocument(req.user!.sub, req.params.id, type, req.file);
  res.status(201).json(vehicle);
}

export async function getDocumentUrlHandler(req: Request, res: Response) {
  const type = docTypeSchema.parse(req.params.type);
  const result = await vehiclesService.getDocumentUrl(req.user!, req.params.id, type);
  res.status(200).json(result);
}
