import { z } from "zod";
import { env } from "../../config/env";
import { distanceKm, fareRange, formatRupees } from "../../lib/fare";
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

// The fare must be plausible for the route's distance (see lib/fare.ts). Reports
// on estimatedCost so the 400's `details` names the field. A value that already
// failed its own format or positivity check (NaN, or 0 here) is left to that
// message instead of getting a second, redundant one.
function requireReasonableFare(value: Coordinates & { estimatedCost: string }, ctx: z.RefinementCtx) {
  const fare = Number(value.estimatedCost);
  if (Number.isNaN(fare) || fare <= 0) {
    return;
  }
  const km = distanceKm(value.originLat, value.originLng, value.destLat, value.destLng);
  const { min, max } = fareRange(km);
  if (fare < min || fare > max) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["estimatedCost"],
      message: `Fare ${formatRupees(fare)} is too ${fare < min ? "low" : "high"} for this ~${Math.round(km)} km route (allowed ${formatRupees(min)}–${formatRupees(max)})`,
    });
  }
}

// With a vehicle the seat count comes from the vehicle (the service sets it and
// rejects a different number); without one — only possible while
// REQUIRE_APPROVED_VEHICLE is off, i.e. the test suite — the caller must say.
function requireSeatsWithoutVehicle(value: { vehicleId?: string; totalSeats?: number }, ctx: z.RefinementCtx) {
  if (value.vehicleId === undefined && value.totalSeats === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["totalSeats"],
      message: "totalSeats is required when no vehicle is selected",
    });
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
  // Optional: fixed by the chosen vehicle's capacity (see assertVehicleCanServeRide).
  totalSeats: z.number().int().positive().optional(),
  // Kept as a validated string, not coerced to a JS number, so it reaches
  // Prisma's Decimal column without ever passing through float arithmetic.
  estimatedCost: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "estimatedCost must be a decimal with up to 2 places")
    .refine((v) => Number(v) > 0, "estimatedCost must be positive"),
  // Required unless REQUIRE_APPROVED_VEHICLE=false (test suite only).
  vehicleId: env.REQUIRE_APPROVED_VEHICLE ? vehicleId : vehicleId.optional(),
}).superRefine((value, ctx) => {
  requireIndia(value, ctx);
  requireReasonableFare(value, ctx);
  requireSeatsWithoutVehicle(value, ctx);
});

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
