import type { Response } from "express";
import ms from "ms";
import { env } from "../config/env";

export const AUTH_COOKIE_NAME = "token";

function cookieOptions() {
  const isProd = env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: (isProd ? "none" : "lax") as "none" | "lax",
    path: "/",
  };
}

export function setAuthCookie(res: Response, token: string) {
  // Cast needed because env.JWT_EXPIRES_IN is validated as a plain `string`
  // (src/config/env.ts) but @types/ms types the parsing overload as the
  // narrower `ms.StringValue` template-literal union — same cast pattern
  // already used for this same env var in src/lib/jwt.ts.
  const maxAge = ms(env.JWT_EXPIRES_IN as ms.StringValue);
  res.cookie(AUTH_COOKIE_NAME, token, { ...cookieOptions(), maxAge });
}

export function clearAuthCookie(res: Response) {
  res.clearCookie(AUTH_COOKIE_NAME, cookieOptions());
}
