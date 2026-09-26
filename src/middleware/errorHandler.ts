import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../lib/AppError";
import { logger } from "../lib/logger";

// Express recognizes an error-handling middleware ONLY by its arity: exactly
// four parameters (err, req, res, next). This must stay last in app.ts, after
// every route — Express walks the middleware chain in order and only reaches
// this one when something upstream calls next(err) or an asyncHandler-wrapped
// promise rejects.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "ValidationError",
      details: err.flatten().fieldErrors,
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.constructor.name, message: err.message });
    return;
  }

  logger.error({ err, path: req.path, method: req.method }, "Unhandled error");
  res.status(500).json({ error: "InternalServerError", message: "Something went wrong" });
}
