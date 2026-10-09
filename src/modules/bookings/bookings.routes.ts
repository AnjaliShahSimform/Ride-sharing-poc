import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler";
import { requireAuth } from "../../middleware/auth.middleware";
import { cancelBookingHandler, getMyBookingsHandler } from "./bookings.controller";

export const bookingsRouter = Router();

bookingsRouter.use(requireAuth);

/**
 * @swagger
 * components:
 *   schemas:
 *     Booking:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         rideId: { type: string, format: uuid }
 *         status: { type: string, enum: [CONFIRMED, CANCELLED] }
 *         costShare: { type: string, description: "This rider's share of the ride's estimatedCost, recalculated whenever the confirmed-rider count changes" }
 *         createdAt: { type: string, format: date-time }
 */

/**
 * @swagger
 * /api/bookings/mine:
 *   get:
 *     summary: Get the authenticated rider's own bookings (any status)
 *     description: Driver contact info (name, phone) is included only for CONFIRMED bookings — never for CANCELLED ones.
 *     tags: [Bookings]
 *     security: [{ cookieAuth: [] }]
 *     responses:
 *       200: { content: { application/json: { schema: { type: array, items: { $ref: '#/components/schemas/Booking' } } } } }
 */
bookingsRouter.get("/mine", asyncHandler(getMyBookingsHandler));

/**
 * @swagger
 * /api/bookings/{id}/cancel:
 *   patch:
 *     summary: Cancel a booking
 *     description: Callable by either the booking's own rider or the ride's driver — no one else. Returns the seat to availability and recalculates the remaining confirmed riders' cost shares, unless the ride is no longer SCHEDULED (e.g. already completed), in which case this returns 409.
 *     tags: [Bookings]
 *     security: [{ cookieAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { content: { application/json: { schema: { $ref: '#/components/schemas/Booking' } } } }
 *       403: { description: Caller is neither the rider nor the ride's driver, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       404: { description: Booking not found, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       409: { description: "Booking already cancelled, or the ride is no longer open", content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
bookingsRouter.patch("/:id/cancel", asyncHandler(cancelBookingHandler));
