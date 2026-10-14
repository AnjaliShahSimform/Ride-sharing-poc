import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth.middleware";
import { vehicleLimiter } from "../../middleware/rateLimit";
import { validateBody } from "../../middleware/validate";
import { createVehicleHandler, getMyVehiclesHandler, updateVehicleHandler } from "./vehicles.controller";
import { createVehicleSchema, updateVehicleSchema } from "./vehicles.schemas";

export const vehiclesRouter = Router();

vehiclesRouter.use(requireAuth);

/**
 * @swagger
 * components:
 *   schemas:
 *     Vehicle:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         make: { type: string }
 *         model: { type: string }
 *         colour: { type: string }
 *         plateNumber: { type: string, description: "Normalised, e.g. MH12AB1234" }
 *         seatCapacity: { type: integer, description: "Passenger seats, excluding the driver (1-8)" }
 *         status: { type: string, enum: [PENDING, APPROVED, REJECTED] }
 *         rejectionNote: { type: string, nullable: true }
 *         reviewedAt: { type: string, format: date-time, nullable: true }
 *         createdAt: { type: string, format: date-time }
 *         documents:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               type: { type: string, enum: [RC, LICENCE] }
 *               uploadedAt: { type: string, format: date-time }
 */

/**
 * @swagger
 * /api/vehicles:
 *   post:
 *     summary: Register a vehicle (driver only)
 *     description: Created as PENDING. It can't be used for a ride until both an RC and a LICENCE document are uploaded and an admin approves it.
 *     tags: [Vehicles]
 *     security: [{ cookieAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [make, model, colour, plateNumber, seatCapacity]
 *             properties:
 *               make: { type: string }
 *               model: { type: string }
 *               colour: { type: string }
 *               plateNumber: { type: string, description: "Indian registration, spaces/dashes ignored, e.g. MH12AB1234" }
 *               seatCapacity: { type: integer, minimum: 1, maximum: 8 }
 *     responses:
 *       201: { content: { application/json: { schema: { $ref: '#/components/schemas/Vehicle' } } } }
 *       400: { description: Invalid input, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       403: { description: Caller isn't a DRIVER, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       409: { description: Plate already registered, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
vehiclesRouter.post("/", requireRole("DRIVER"), vehicleLimiter, validateBody(createVehicleSchema), asyncHandler(createVehicleHandler));

/**
 * @swagger
 * /api/vehicles/mine:
 *   get:
 *     summary: List the caller's own vehicles with status, rejection note and which documents are uploaded (driver only)
 *     tags: [Vehicles]
 *     security: [{ cookieAuth: [] }]
 *     responses:
 *       200: { content: { application/json: { schema: { type: array, items: { $ref: '#/components/schemas/Vehicle' } } } } }
 *       403: { description: Caller isn't a DRIVER, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
vehiclesRouter.get("/mine", requireRole("DRIVER"), asyncHandler(getMyVehiclesHandler));

/**
 * @swagger
 * /api/vehicles/{id}:
 *   patch:
 *     summary: Edit a vehicle (driver, owner only)
 *     description: Changing make, model, plate or capacity on an APPROVED vehicle sends it back to PENDING for re-review. Colour doesn't. Editing a REJECTED vehicle resubmits it as PENDING. Rides already posted keep their snapshot.
 *     tags: [Vehicles]
 *     security: [{ cookieAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               make: { type: string }
 *               model: { type: string }
 *               colour: { type: string }
 *               plateNumber: { type: string }
 *               seatCapacity: { type: integer, minimum: 1, maximum: 8 }
 *     responses:
 *       200: { content: { application/json: { schema: { $ref: '#/components/schemas/Vehicle' } } } }
 *       400: { description: Invalid input or empty body, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       403: { description: Not the owner, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       404: { description: Vehicle not found, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       409: { description: Plate already registered, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
vehiclesRouter.patch("/:id", requireRole("DRIVER"), vehicleLimiter, validateBody(updateVehicleSchema), asyncHandler(updateVehicleHandler));
