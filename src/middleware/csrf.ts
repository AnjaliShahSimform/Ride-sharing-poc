import type { NextFunction, Request, Response } from "express";
import { ForbiddenError } from "../lib/AppError";

export const CSRF_HEADER_NAME = "x-requested-with";
export const CSRF_HEADER_VALUE = "XMLHttpRequest";

const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

// SameSite=None (required because the frontend and API deploy as separate
// sites — design spec §3) gives the cookie no CSRF protection on its own.
// A plain cross-site HTML form can't set a custom header, so requiring one
// here blocks the classic CSRF vector without a full token scheme.
export function requireCsrfHeader(req: Request, _res: Response, next: NextFunction) {
  if (!MUTATING_METHODS.has(req.method)) {
    next();
    return;
  }
  if (req.headers[CSRF_HEADER_NAME] !== CSRF_HEADER_VALUE) {
    throw new ForbiddenError("Missing required CSRF header");
  }
  next();
}
