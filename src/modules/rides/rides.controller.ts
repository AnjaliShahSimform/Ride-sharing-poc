import type { Request, Response } from "express";
import * as ridesService from "./rides.service";
import type { SearchRidesQuery } from "./rides.schemas";

export async function createRideHandler(req: Request, res: Response) {
  const ride = await ridesService.createRide(req.user!.sub, req.body);
  res.status(201).json(ride);
}

export async function searchRidesHandler(req: Request, res: Response) {
  const rides = await ridesService.searchRides(req.query as unknown as SearchRidesQuery);
  res.status(200).json(rides);
}

export async function cancelRideHandler(req: Request, res: Response) {
  const ride = await ridesService.cancelRide(req.user!.sub, req.params.id);
  res.status(200).json(ride);
}

export async function completeRideHandler(req: Request, res: Response) {
  const ride = await ridesService.completeRide(req.user!.sub, req.params.id);
  res.status(200).json(ride);
}
