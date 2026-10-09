import type { Request, Response } from "express";
import * as bookingsService from "./bookings.service";

export async function createBookingHandler(req: Request, res: Response) {
  const booking = await bookingsService.bookSeat(req.params.id, req.user!.sub);
  res.status(201).json(booking);
}

export async function cancelBookingHandler(req: Request, res: Response) {
  const booking = await bookingsService.cancelBooking(req.user!.sub, req.params.id);
  res.status(200).json(booking);
}

export async function getMyBookingsHandler(req: Request, res: Response) {
  const bookings = await bookingsService.getMyBookings(req.user!.sub);
  res.status(200).json(bookings);
}

export async function getRideBookingsHandler(req: Request, res: Response) {
  const bookings = await bookingsService.getRideBookings(req.user!.sub, req.params.id);
  res.status(200).json(bookings);
}
