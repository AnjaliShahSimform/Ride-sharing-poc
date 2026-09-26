import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth.middleware";
import { validateBody, validateQuery } from "../../middleware/validate";
import { cancelRideHandler, completeRideHandler, createRideHandler, searchRidesHandler } from "./rides.controller";
import { createRideSchema, searchRidesQuerySchema } from "./rides.schemas";

export const ridesRouter = Router();

ridesRouter.use(requireAuth);

ridesRouter.post("/", requireRole("DRIVER"), validateBody(createRideSchema), asyncHandler(createRideHandler));
ridesRouter.get("/search", validateQuery(searchRidesQuerySchema), asyncHandler(searchRidesHandler));
ridesRouter.patch("/:id/cancel", requireRole("DRIVER"), asyncHandler(cancelRideHandler));
ridesRouter.patch("/:id/complete", requireRole("DRIVER"), asyncHandler(completeRideHandler));
