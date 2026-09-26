import { z } from "zod";

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
});

export type SearchRidesQuery = z.infer<typeof searchRidesQuerySchema>;
