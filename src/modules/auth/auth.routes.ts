import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler";
import { requireAuth } from "../../middleware/auth.middleware";
import { validateBody } from "../../middleware/validate";
import { loginHandler, logoutHandler, meHandler, signupHandler } from "./auth.controller";
import { loginSchema, signupSchema } from "./auth.schemas";

export const authRouter = Router();

authRouter.post("/signup", validateBody(signupSchema), asyncHandler(signupHandler));
authRouter.post("/login", validateBody(loginSchema), asyncHandler(loginHandler));
authRouter.post("/logout", logoutHandler);
authRouter.get("/me", requireAuth, asyncHandler(meHandler));
