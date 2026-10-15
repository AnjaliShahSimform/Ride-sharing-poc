import type { Request, Response } from "express";
import {
  REFRESH_COOKIE_NAME,
  clearAuthCookie,
  clearRefreshCookie,
  setAuthCookie,
  setRefreshCookie,
} from "../../lib/authCookie";
import * as authService from "./auth.service";

export async function signupHandler(req: Request, res: Response) {
  const { user, token, refreshToken } = await authService.signup(req.body);
  setAuthCookie(res, token);
  setRefreshCookie(res, refreshToken);
  res.status(201).json({ user });
}

export async function loginHandler(req: Request, res: Response) {
  const { user, token, refreshToken } = await authService.login(req.body);
  setAuthCookie(res, token);
  setRefreshCookie(res, refreshToken);
  res.status(200).json({ user });
}

export async function refreshHandler(req: Request, res: Response) {
  try {
    const { user, token, refreshToken } = await authService.refresh(req.cookies?.[REFRESH_COOKIE_NAME]);
    setAuthCookie(res, token);
    if (refreshToken) {
      setRefreshCookie(res, refreshToken);
    }
    res.status(200).json({ user });
  } catch (err) {
    // A refresh token that failed is dead weight (expired, revoked, or replayed);
    // drop both cookies so the browser stops sending it.
    clearAuthCookie(res);
    clearRefreshCookie(res);
    throw err;
  }
}

export async function meHandler(req: Request, res: Response) {
  const user = await authService.getById(req.user!.sub);
  res.status(200).json({ user });
}

export async function updateMeHandler(req: Request, res: Response) {
  const user = await authService.updateProfile(req.user!.sub, req.body);
  res.status(200).json({ user });
}

export async function logoutHandler(req: Request, res: Response) {
  await authService.logout(req.cookies?.[REFRESH_COOKIE_NAME]);
  clearAuthCookie(res);
  clearRefreshCookie(res);
  res.status(200).json({ message: "Logged out" });
}
