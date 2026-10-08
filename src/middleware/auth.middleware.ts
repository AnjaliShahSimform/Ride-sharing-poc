import type { NextFunction, Request, Response } from "express";
import { ForbiddenError, UnauthenticatedError } from "../lib/AppError";
import { AUTH_COOKIE_NAME } from "../lib/authCookie";
import { verifyToken } from "../lib/jwt";

// Authentication: who are you? Every route but signup/login needs this.
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[AUTH_COOKIE_NAME];
  if (!token) {
    throw new UnauthenticatedError();
  }

  try {
    req.user = verifyToken(token);
  } catch {
    throw new UnauthenticatedError("Invalid or expired token");
  }

  next();
}

// Authorization (RBAC): given who you are, are you allowed to call this
// ROUTE at all? This is separate from ownership checks (§ service layer),
// which decide whether you're allowed to act on this specific RECORD.
export function requireRole(...allowed: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const roles = req.user?.roles ?? [];
    const hasRole = allowed.some((role) => roles.includes(role));
    if (!hasRole) {
      throw new ForbiddenError(`Requires one of roles: ${allowed.join(", ")}`);
    }
    next();
  };
}
