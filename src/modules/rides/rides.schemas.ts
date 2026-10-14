import { z } from "zod";
import { env } from "../../config/env";
import { isWithinIndia } from "../../lib/indiaBounds";

type Coordinates = { originLat: number; originLng: number; destLat: number; destLng: number };

// Reports on the lat field so the 400's `details` names it, like every other
// field error. Zod only runs this once the object's field types parsed, so the
// values are always numbers here.
function requireIndia(value: Coordinates, ctx: z.RefinementCtx) {
  if (!isWithinIndia(value.originLat, value.originLng)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["originLat"], message: "Origin must be within India" });
  }
  if (!isWithinIndia(value.destLat, value.destLng)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["destLat"], message: "Destination must be within India" });
  }
}

const vehicleId = z.string().uuid("vehicleId must be a valid id");

export const createRideSchema = z.object({
  originLat: z.number().min(-90).max(90),
  originLng: z.number().min(-180).max(180),
  destLat: z.number().min(-90).max(90),
  destLng: z.number().min(-180).max(180),
  originLabel: z.string().min(1),
  destLabel: z.string().min(1),
  departureTime: z.coerce.date().refine((d) => d.getTime() > Date.now(), {
    message: "departureTime must be in the future",
  }),
  totalSeats: z.number().int().positive(),
  // Kept as a validated string, not coerced to a JS number, so it reaches
  // Prisma's Decimal column without ever passing through float arithmetic.
  estimatedCost: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "estimatedCost must be a decimal with up to 2 places")
    .refine((v) => Number(v) > 0, "estimatedCost must be positive"),
  // Required unless REQUIRE_APPROVED_VEHICLE=false (test suite only).
  vehicleId: env.REQUIRE_APPROVED_VEHICLE ? vehicleId : vehicleId.optional(),
}).superRefine(requireIndia);

export type CreateRideInput = z.infer<typeof createRideSchema>;

export const searchRidesQuerySchema = z.object({
  originLat: z.coerce.number().min(-90).max(90),
  originLng: z.coerce.number().min(-180).max(180),
  destLat: z.coerce.number().min(-90).max(90),
  destLng: z.coerce.number().min(-180).max(180),
  earliestDeparture: z.coerce.date(),
  latestDeparture: z.coerce.date(),
  radiusKm: z.coerce.number().positive().default(10),
}).superRefine(requireIndia);

export type SearchRidesQuery = z.infer<typeof searchRidesQuerySchema>;
