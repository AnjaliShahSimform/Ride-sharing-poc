import type { Request, Response } from "express";
import * as authService from "./auth.service";

export async function signupHandler(req: Request, res: Response) {
  const result = await authService.signup(req.body);
  res.status(201).json(result);
}

export async function loginHandler(req: Request, res: Response) {
  const result = await authService.login(req.body);
  res.status(200).json(result);
}
