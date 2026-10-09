import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware";

export const bookingsRouter = Router();

bookingsRouter.use(requireAuth);

// Intentionally empty for now — GET /mine and PATCH /:id/cancel are added in
// Task 3. This file exists from Task 2 onward so app.ts's mount point is
// stable across tasks.
