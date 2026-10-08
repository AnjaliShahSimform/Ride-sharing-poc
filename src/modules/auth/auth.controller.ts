import type { Request, Response } from "express";
import { setAuthCookie } from "../../lib/authCookie";
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
