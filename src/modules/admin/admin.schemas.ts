import { z } from "zod";
import { parseIstDate } from "../../lib/rideTime";

// Shared by every admin list. Page numbers and sizes arrive as query strings.
export const paginationShape = {
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(50),
};

// A real "YYYY-MM-DD" calendar date, read as an IST day (see lib/rideTime.ts).
const istDate = z.string().refine(parseIstDate, "must be a valid date in YYYY-MM-DD format");

// Free-text search box; blank means "no search".
const searchText = z
  .string()
  .trim()
  .max(100)
  .optional()
  .transform((v) => (v ? v : undefined));

// An inverted range would silently return nothing — say so instead.
function orderedRange<T extends Record<string, unknown>>(from: keyof T & string, to: keyof T & string) {
  return (v: T, ctx: z.RefinementCtx) => {
    const a = v[from];
    const b = v[to];
    if (typeof a === "string" && typeof b === "string" && a > b) {
      ctx.addIssue({ code: "custom", path: [to], message: `${to} must not be before ${from}` });
    }
  };
}

export const auditLogQuerySchema = z
  .object({
    ...paginationShape,
    entityType: z.enum(["Ride", "Booking", "Vehicle"]).optional(),
    action: z.string().trim().min(1).max(50).optional(),
    from: istDate.optional(),
    to: istDate.optional(),
  })
  .superRefine(orderedRange("from", "to"));

export const adminUsersQuerySchema = z
  .object({
    ...paginationShape,
    role: z.enum(["DRIVER", "RIDER", "ADMIN"]).optional(),
    q: searchText,
    joinedFrom: istDate.optional(),
    joinedTo: istDate.optional(),
  })
  .superRefine(orderedRange("joinedFrom", "joinedTo"));

export const adminRidesQuerySchema = z
  .object({
    ...paginationShape,
    status: z.enum(["SCHEDULED", "COMPLETED", "CANCELLED"]).optional(),
    q: searchText,
    departureFrom: istDate.optional(),
    departureTo: istDate.optional(),
  })
  .superRefine(orderedRange("departureFrom", "departureTo"));

export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
export type AdminUsersQuery = z.infer<typeof adminUsersQuerySchema>;
export type AdminRidesQuery = z.infer<typeof adminRidesQuerySchema>;
