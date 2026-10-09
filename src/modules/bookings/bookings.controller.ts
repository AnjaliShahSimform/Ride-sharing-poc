import type { Request, Response } from "express";
import * as bookingsService from "./bookings.service";

export async function createBookingHandler(req: Request, res: Response) {
  const booking = await bookingsService.bookSeat(req.params.id, req.user!.sub);
  res.status(201).json(booking);
}
