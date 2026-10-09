import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth.middleware";
import { validateBody, validateQuery } from "../../middleware/validate";
import { createBookingHandler, getRideBookingsHandler } from "../bookings/bookings.controller";
import {
  cancelRideHandler,
  completeRideHandler,
  createRideHandler,
  editRideHandler,
  getMyRidesHandler,
  searchRidesHandler,
} from "./rides.controller";
import { createRideSchema, searchRidesQuerySchema } from "./rides.schemas";

export const ridesRouter = Router();

ridesRouter.use(requireAuth);

/**
 * @swagger
 * components:
 *   schemas:
 *     Ride:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         driverId: { type: string, format: uuid }
 *         originLabel: { type: string }
 *         originLat: { type: number }
 *         originLng: { type: number }
 *         destLabel: { type: string }
 *         destLat: { type: number }
 *         destLng: { type: number }
 *         departureTime: { type: string, format: date-time }
 *         totalSeats: { type: integer }
 *         seatsAvailable: { type: integer }
 *         estimatedCost: { type: string, description: "Decimal as a string, e.g. \"1200.00\" — never a float" }
 *         status: { type: string, enum: [SCHEDULED, CANCELLED, COMPLETED] }
 */

/**
 * @swagger
 * /api/rides:
 *   post:
 *     summary: Post a ride (driver only)
 *     tags: [Rides]
 *     security: [{ cookieAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [originLat, originLng, destLat, destLng, originLabel, destLabel, departureTime, totalSeats, estimatedCost]
 *             properties:
 *               originLat: { type: number, minimum: -90, maximum: 90 }
 *               originLng: { type: number, minimum: -180, maximum: 180 }
 *               destLat: { type: number, minimum: -90, maximum: 90 }
 *               destLng: { type: number, minimum: -180, maximum: 180 }
 *               originLabel: { type: string }
 *               destLabel: { type: string }
 *               departureTime: { type: string, format: date-time, description: "Must be in the future" }
 *               totalSeats: { type: integer, minimum: 1 }
 *               estimatedCost: { type: string, pattern: '^\\d+(\\.\\d{1,2})?$', description: "Decimal string, e.g. \"1200.00\"" }
 *     responses:
 *       201: { description: Ride created, content: { application/json: { schema: { $ref: '#/components/schemas/Ride' } } } }
 *       400: { description: "Bad input (past departureTime, totalSeats <= 0)", content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       403: { description: Caller isn't a DRIVER, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
ridesRouter.post("/", requireRole("DRIVER"), validateBody(createRideSchema), asyncHandler(createRideHandler));

/**
 * @swagger
 * /api/rides/search:
 *   get:
 *     summary: Search for rides matching a route and time window
 *     description: A real indexed bounding-box query on both origin and destination, ANDed with a time-window range — not an in-memory filter. Never includes driver contact fields.
 *     tags: [Rides]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: query, name: originLat, required: true, schema: { type: number } }
 *       - { in: query, name: originLng, required: true, schema: { type: number } }
 *       - { in: query, name: destLat, required: true, schema: { type: number } }
 *       - { in: query, name: destLng, required: true, schema: { type: number } }
 *       - { in: query, name: earliestDeparture, required: true, schema: { type: string, format: date-time } }
 *       - { in: query, name: latestDeparture, required: true, schema: { type: string, format: date-time } }
 *       - { in: query, name: radiusKm, required: false, schema: { type: number, default: 10 } }
 *     responses:
 *       200:
 *         description: "Matching SCHEDULED rides with at least one seat available"
 *         content:
 *           application/json:
 *             schema: { type: array, items: { $ref: '#/components/schemas/Ride' } }
 */
ridesRouter.get("/search", validateQuery(searchRidesQuerySchema), asyncHandler(searchRidesHandler));

/**
 * @swagger
 * /api/rides/mine:
 *   get:
 *     summary: Get the authenticated driver's own posted rides (driver only)
 *     description: Unlike search, returns every status (SCHEDULED, CANCELLED, COMPLETED) — not just bookable rides.
 *     tags: [Rides]
 *     security: [{ cookieAuth: [] }]
 *     responses:
 *       200: { content: { application/json: { schema: { type: array, items: { $ref: '#/components/schemas/Ride' } } } } }
 *       403: { description: Caller isn't a DRIVER, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
ridesRouter.get("/mine", requireRole("DRIVER"), asyncHandler(getMyRidesHandler));

/**
 * @swagger
 * /api/rides/{id}:
 *   patch:
 *     summary: Edit a ride's details (driver, own ride only)
 *     description: Blocked once the ride has any CONFIRMED booking (409) — a rider who already has a seat shouldn't have the route/time change under them. Cancel and repost instead. Same request body as POST /api/rides; seatsAvailable is reset to the new totalSeats.
 *     tags: [Rides]
 *     security: [{ cookieAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [originLat, originLng, destLat, destLng, originLabel, destLabel, departureTime, totalSeats, estimatedCost]
 *             properties:
 *               originLat: { type: number, minimum: -90, maximum: 90 }
 *               originLng: { type: number, minimum: -180, maximum: 180 }
 *               destLat: { type: number, minimum: -90, maximum: 90 }
 *               destLng: { type: number, minimum: -180, maximum: 180 }
 *               originLabel: { type: string }
 *               destLabel: { type: string }
 *               departureTime: { type: string, format: date-time, description: "Must be in the future" }
 *               totalSeats: { type: integer, minimum: 1 }
 *               estimatedCost: { type: string, pattern: '^\\d+(\\.\\d{1,2})?$' }
 *     responses:
 *       200: { description: Ride updated, content: { application/json: { schema: { $ref: '#/components/schemas/Ride' } } } }
 *       400: { description: "Bad input (past departureTime, totalSeats <= 0)", content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       403: { description: Not this ride's driver, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       404: { description: Ride not found, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       409: { description: "Ride is no longer SCHEDULED, or has a confirmed booking", content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
ridesRouter.patch("/:id", requireRole("DRIVER"), validateBody(createRideSchema), asyncHandler(editRideHandler));

/**
 * @swagger
 * /api/rides/{id}/cancel:
 *   patch:
 *     summary: Cancel a ride (driver, own ride only)
 *     description: Cascades — every CONFIRMED booking on this ride also flips to CANCELLED, in the same transaction.
 *     tags: [Rides]
 *     security: [{ cookieAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { content: { application/json: { schema: { $ref: '#/components/schemas/Ride' } } } }
 *       403: { description: Not this ride's driver, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       404: { description: Ride not found, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       409: { description: Ride is already cancelled or completed, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
ridesRouter.patch("/:id/cancel", requireRole("DRIVER"), asyncHandler(cancelRideHandler));

/**
 * @swagger
 * /api/rides/{id}/complete:
 *   patch:
 *     summary: Mark a ride completed (driver, own ride only)
 *     description: Locks the ride — no further cancel/complete/booking/booking-cancel is possible on it afterward.
 *     tags: [Rides]
 *     security: [{ cookieAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { content: { application/json: { schema: { $ref: '#/components/schemas/Ride' } } } }
 *       403: { description: Not this ride's driver, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       404: { description: Ride not found, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       409: { description: Ride is already cancelled or completed, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
ridesRouter.patch("/:id/complete", requireRole("DRIVER"), asyncHandler(completeRideHandler));

/**
 * @swagger
 * /api/rides/{id}/bookings:
 *   post:
 *     summary: Book a seat on this ride (rider only)
 *     description: Race-safe — a single conditional atomic UPDATE guarantees exactly one winner when two riders race for the last seat.
 *     tags: [Bookings]
 *     security: [{ cookieAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       201: { description: Booking confirmed, content: { application/json: { schema: { $ref: '#/components/schemas/Booking' } } } }
 *       403: { description: Caller isn't a RIDER, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       404: { description: Ride not found, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       409: { description: "No seats available, or the ride isn't open for booking", content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *   get:
 *     summary: List bookings for this ride (driver, own ride only)
 *     description: Rider contact info (name, phone) is included only for CONFIRMED bookings.
 *     tags: [Bookings]
 *     security: [{ cookieAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { content: { application/json: { schema: { type: array, items: { $ref: '#/components/schemas/Booking' } } } } }
 *       403: { description: Not this ride's driver, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       404: { description: Ride not found, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
ridesRouter.post("/:id/bookings", requireRole("RIDER"), asyncHandler(createBookingHandler));
ridesRouter.get("/:id/bookings", requireRole("DRIVER"), asyncHandler(getRideBookingsHandler));
