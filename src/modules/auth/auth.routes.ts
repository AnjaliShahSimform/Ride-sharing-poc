import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler";
import { requireAuth } from "../../middleware/auth.middleware";
import { validateBody } from "../../middleware/validate";
import { loginHandler, logoutHandler, meHandler, signupHandler } from "./auth.controller";
import { loginSchema, signupSchema } from "./auth.schemas";

export const authRouter = Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     User:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         name: { type: string }
 *         email: { type: string, format: email }
 *         phone: { type: string }
 *         roles: { type: array, items: { type: string, enum: [DRIVER, RIDER, ADMIN] } }
 *     Error:
 *       type: object
 *       properties:
 *         error: { type: string }
 *         message: { type: string }
 */

/**
 * @swagger
 * /api/auth/signup:
 *   post:
 *     summary: Create an account
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, phone, password, role]
 *             properties:
 *               name: { type: string }
 *               email: { type: string, format: email }
 *               phone: { type: string }
 *               password: { type: string, minLength: 8 }
 *               role: { type: string, enum: [DRIVER, RIDER] }
 *     responses:
 *       201:
 *         description: Account created. Sets an httpOnly `token` session cookie — the response body never includes a token.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user: { $ref: '#/components/schemas/User' }
 *       400: { description: Validation error, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       409: { description: An account with this email already exists, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
authRouter.post("/signup", validateBody(signupSchema), asyncHandler(signupHandler));

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Log in
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Sets an httpOnly `token` session cookie.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user: { $ref: '#/components/schemas/User' }
 *       401: { description: Invalid email or password, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
authRouter.post("/login", validateBody(loginSchema), asyncHandler(loginHandler));

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Log out
 *     description: Clears the session cookie. Always succeeds, even with no existing session. Requires the `X-Requested-With` CSRF header, no auth required.
 *     tags: [Auth]
 *     responses:
 *       200: { description: Logged out }
 */
authRouter.post("/logout", logoutHandler);

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Get the current session's user
 *     description: The only way a browser client can learn who's logged in, since the JWT itself lives in an httpOnly cookie it can't read.
 *     tags: [Auth]
 *     security: [{ cookieAuth: [] }]
 *     responses:
 *       200:
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user: { $ref: '#/components/schemas/User' }
 *       401: { description: No or invalid session, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
authRouter.get("/me", requireAuth, asyncHandler(meHandler));
