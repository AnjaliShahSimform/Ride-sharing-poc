import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler";
import { requireAuth } from "../../middleware/auth.middleware";
import { cancelBookingHandler, getMyBookingsHandler } from "./bookings.controller";

export const bookingsRouter = Router();

bookingsRouter.use(requireAuth);
bookingsRouter.get("/mine", asyncHandler(getMyBookingsHandler));
bookingsRouter.patch("/:id/cancel", asyncHandler(cancelBookingHandler));
