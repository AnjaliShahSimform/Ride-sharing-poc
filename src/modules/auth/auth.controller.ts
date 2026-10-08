import type { Request, Response } from "express";
import { clearAuthCookie, setAuthCookie } from "../../lib/authCookie";
import * as authService from "./auth.service";

export async function signupHandler(req: Request, res: Response) {
  const { user, token } = await authService.signup(req.body);
  setAuthCookie(res, token);
  res.status(201).json({ user });
}

export async function loginHandler(req: Request, res: Response) {
  const { user, token } = await authService.login(req.body);
  setAuthCookie(res, token);
  res.status(200).json({ user });
}

export async function meHandler(req: Request, res: Response) {
  const user = await authService.getById(req.user!.sub);
  res.status(200).json({ user });
}

export function logoutHandler(_req: Request, res: Response) {
  clearAuthCookie(res);
  res.status(200).json({ message: "Logged out" });
}
