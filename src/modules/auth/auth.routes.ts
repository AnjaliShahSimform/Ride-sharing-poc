import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler";
import { requireAuth } from "../../middleware/auth.middleware";
import { loginLimiter, refreshLimiter, signupLimiter, writeLimiter } from "../../middleware/rateLimit";
import { validateBody } from "../../middleware/validate";
import { loginHandler, logoutHandler, meHandler, refreshHandler, signupHandler, updateMeHandler } from "./auth.controller";
import { loginSchema, signupSchema, updateProfileSchema } from "./auth.schemas";

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
 *         createdAt: { type: string, format: date-time }
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
 *         description: Account created. Sets an httpOnly `token` access cookie (15 min) and an httpOnly `refresh_token` cookie (7 days, path `/api/auth`) — the response body never includes a token.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user: { $ref: '#/components/schemas/User' }
 *       400: { description: Validation error, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       429: { description: "Too many signups from this IP (5 per hour)", content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       409: { description: An account with this email already exists, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
authRouter.post("/signup", signupLimiter, validateBody(signupSchema), asyncHandler(signupHandler));

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
 *         description: Sets the httpOnly `token` access cookie and `refresh_token` cookie (see signup).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user: { $ref: '#/components/schemas/User' }
 *       429: { description: "Too many failed logins from this IP (10 per 15 minutes)", content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       401: { description: Invalid email or password, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
authRouter.post("/login", loginLimiter, validateBody(loginSchema), asyncHandler(loginHandler));

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Log out
 *     description: Revokes the refresh token (if the cookie is present) and clears both session cookies. Always succeeds, even with no existing session. Requires the `X-Requested-With` CSRF header, no auth required.
 *     tags: [Auth]
 *     responses:
 *       200: { description: Logged out }
 */
authRouter.post("/logout", asyncHandler(logoutHandler));

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     summary: Exchange the refresh cookie for a new access cookie
 *     description: |
 *       No body and no access cookie needed (it is usually expired when this is called); the
 *       httpOnly `refresh_token` cookie is the credential. Requires the `X-Requested-With`
 *       CSRF header. The refresh token is single-use: a successful call revokes it and sets
 *       a new `token` and a new `refresh_token`. If the same refresh token arrives again
 *       within a few seconds (another tab refreshing concurrently) only a new `token` is set.
 *       A refresh token presented again after that is treated as replayed — every refresh
 *       token for the user is revoked and the call is a 401.
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: New session cookies set.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user: { $ref: '#/components/schemas/User' }
 *       401: { description: Missing, unknown, expired or replayed refresh token (both cookies are cleared), content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       429: { description: "Too many refreshes from this IP (30 per minute)", content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
authRouter.post("/refresh", refreshLimiter, asyncHandler(refreshHandler));

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

/**
 * @swagger
 * /api/auth/me:
 *   patch:
 *     summary: Update the current user's name and/or phone
 *     description: Email and roles can't be changed here — any other key is a 400. Send at least one of name or phone.
 *     tags: [Auth]
 *     security: [{ cookieAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string, minLength: 1, maxLength: 100 }
 *               phone: { type: string, minLength: 7, maxLength: 20 }
 *     responses:
 *       200:
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user: { $ref: '#/components/schemas/User' }
 *       400: { description: Empty body, blank name, short phone or an unknown key, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       401: { description: No or invalid session, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
authRouter.patch("/me", requireAuth, writeLimiter, validateBody(updateProfileSchema), asyncHandler(updateMeHandler));
