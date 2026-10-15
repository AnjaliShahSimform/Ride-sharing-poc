import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth.middleware";
import { writeLimiter } from "../../middleware/rateLimit";
import { validateBody, validateQuery } from "../../middleware/validate";
import { listVehiclesForReviewHandler, reviewVehicleHandler } from "../vehicles/vehicles.controller";
import { reviewQuerySchema, reviewVehicleSchema } from "../vehicles/vehicles.schemas";
import { getAllRidesHandler, getAllUsersHandler, getAuditLogsHandler } from "./admin.controller";
import { auditLogQuerySchema } from "./admin.schemas";

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole("ADMIN"), writeLimiter);

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
 *                       entityType: { type: string, enum: [Ride, Booking, Vehicle] }
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

/**
 * @swagger
 * /api/admin/vehicles:
 *   get:
 *     summary: Vehicle review queue (admin only), oldest first
 *     description: Defaults to PENDING. Each vehicle includes its owner ({ id, name, email }) and which documents are uploaded, plus a `reviewVersion` string (a fingerprint of the details and documents as listed) to send back when reviewing. View a document through GET /api/vehicles/{id}/documents/{type}.
 *     tags: [Admin]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: query, name: status, required: false, schema: { type: string, enum: [PENDING, APPROVED, REJECTED], default: PENDING } }
 *     responses:
 *       200: { content: { application/json: { schema: { type: array, items: { $ref: '#/components/schemas/Vehicle' } } } } }
 *       403: { description: Caller isn't an ADMIN, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
adminRouter.get("/vehicles", validateQuery(reviewQuerySchema), asyncHandler(listVehiclesForReviewHandler));

/**
 * @swagger
 * /api/admin/vehicles/{id}/review:
 *   patch:
 *     summary: Approve or reject a PENDING vehicle (admin only)
 *     description: Approval needs both RC and LICENCE uploaded (409 otherwise). Rejection needs a note and frees the plate. Only a PENDING vehicle can be reviewed (409 otherwise, including when another admin decided first). An admin can't review their own vehicle (403). The owner is emailed. Copy the `reviewVersion` from GET /api/admin/vehicles; the review is rejected with 409 if the vehicle's details or documents changed since.
 *     tags: [Admin]
 *     security: [{ cookieAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [decision, reviewVersion]
 *             properties:
 *               decision: { type: string, enum: [APPROVED, REJECTED] }
 *               reviewVersion: { type: string, description: "From GET /api/admin/vehicles; pins the review to the details and documents the admin saw" }
 *               note: { type: string, maxLength: 500, description: "Required when REJECTED" }
 *     responses:
 *       200: { content: { application/json: { schema: { $ref: '#/components/schemas/Vehicle' } } } }
 *       400: { description: Invalid decision, missing reviewVersion or missing rejection note, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       403: { description: Not an admin, or reviewing own vehicle, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       404: { description: Vehicle not found, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       409: { description: "Not PENDING, documents missing, or the vehicle's details/documents changed since reviewVersion was issued", content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
adminRouter.patch("/vehicles/:id/review", validateBody(reviewVehicleSchema), asyncHandler(reviewVehicleHandler));
