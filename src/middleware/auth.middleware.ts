import type { NextFunction, Request, Response } from "express";
import { ForbiddenError, PhoneNotVerifiedError, UnauthenticatedError } from "../lib/AppError";
import { AUTH_COOKIE_NAME } from "../lib/authCookie";
import { verifyToken } from "../lib/jwt";

// Reads and verifies the JWT cookie, setting req.user. Shared by both flavours.
function authenticate(req: Request) {
  const token = req.cookies?.[AUTH_COOKIE_NAME];
  if (!token) {
    throw new UnauthenticatedError();
  }
  try {
    req.user = verifyToken(token);
  } catch {
    throw new UnauthenticatedError("Invalid or expired token");
  }
}

// Authentication: who are you? Every route but signup/login needs this. It also
// blocks an account that hasn't verified its phone — secure by default, so a new
// route is gated without anyone remembering to add anything. The few routes an
// unverified account may reach use requireAuthAllowUnverified instead.
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  authenticate(req);
  // `=== false`, not falsy: a token issued before phone verification existed
  // has no claim and belongs to a grandfathered (verified) account.
  if (req.user!.phoneVerified === false) {
    throw new PhoneNotVerifiedError();
  }
  next();
}

// Same, for the few routes an account that hasn't verified its phone must still
// reach: /me, verify-phone and its resend.
export function requireAuthAllowUnverified(req: Request, _res: Response, next: NextFunction) {
  authenticate(req);
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
