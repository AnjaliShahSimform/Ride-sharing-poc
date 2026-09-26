import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";

// A synchronous throw inside ordinary (non-async) middleware IS caught
// automatically by Express and routed to the error handler — no asyncHandler
// wrapper needed here. That wrapper only exists for async/await, because a
// rejected promise is not the same thing as a synchronous throw.
export const validateBody = (schema: ZodSchema) => (req: Request, _res: Response, next: NextFunction) => {
  req.body = schema.parse(req.body);
  next();
};
