import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth.middleware";
import { validateQuery } from "../../middleware/validate";
import { getAllRidesHandler, getAllUsersHandler, getAuditLogsHandler } from "./admin.controller";
import { auditLogQuerySchema } from "./admin.schemas";

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole("ADMIN"));

/**
 * @swagger
 * /api/admin/users:
 *   get:
 *     summary: List every user in the system (admin only)
 *     description: Never includes passwordHash. There is no self-service signup path to ADMIN — admin accounts are created directly in the database.
 *     tags: [Admin]
 *     security: [{ cookieAuth: [] }]
 *     responses:
 *       200: { content: { application/json: { schema: { type: array, items: { $ref: '#/components/schemas/User' } } } } }
 *       403: { description: Caller isn't an ADMIN, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
adminRouter.get("/users", asyncHandler(getAllUsersHandler));

/**
 * @swagger
 * /api/admin/rides:
 *   get:
 *     summary: List every ride from every driver, any status (admin only)
 *     description: Each ride also includes a nested driver object ({ id, name, email }) not present on the plain Ride schema, so the admin view doesn't need a second lookup per row.
 *     tags: [Admin]
 *     security: [{ cookieAuth: [] }]
 *     responses:
 *       200: { content: { application/json: { schema: { type: array, items: { $ref: '#/components/schemas/Ride' } } } } }
 *       403: { description: Caller isn't an ADMIN, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
adminRouter.get("/rides", asyncHandler(getAllRidesHandler));

/**
 * @swagger
 * /api/admin/audit-logs:
 *   get:
 *     summary: List audit log entries newest first, paginated (admin only)
 *     description: The structured dispute-evidence trail written by every ride/booking mutation — see src/lib/auditLog.ts.
 *     tags: [Admin]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, required: false, schema: { type: integer, default: 1 } }
 *       - { in: query, name: pageSize, required: false, schema: { type: integer, default: 50, maximum: 200 } }
 *     responses:
 *       200:
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 entries:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string, format: uuid }
 *                       entityType: { type: string, enum: [Ride, Booking] }
 *                       entityId: { type: string, format: uuid }
 *                       action: { type: string }
 *                       actorId: { type: string }
 *                       metadata: { type: object, nullable: true }
 *                       createdAt: { type: string, format: date-time }
 *                 total: { type: integer }
 *                 page: { type: integer }
 *                 pageSize: { type: integer }
 *       403: { description: Caller isn't an ADMIN, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
adminRouter.get("/audit-logs", validateQuery(auditLogQuerySchema), asyncHandler(getAuditLogsHandler));
