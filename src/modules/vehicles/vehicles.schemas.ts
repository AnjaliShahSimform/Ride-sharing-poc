import { z } from "zod";

// Uppercase and strip spaces/dashes so "mh-12 ab 1234" and "MH12AB1234" are the
// same plate everywhere (validation, the unique key, comparisons).
export function normalisePlate(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, "");
}

// Indian registration: 2-letter state, 1-2 digit district, 0-3 letter series,
// 4 digits (e.g. MH12AB1234, DL8CAF3456). BH-series plates are out of scope.
export const PLATE_REGEX = /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/;

const text = (name: string) =>
  z.string().trim().min(1, `${name} is required`).max(50, `${name} must be at most 50 characters`);

export const createVehicleSchema = z.object({
  make: text("make"),
  model: text("model"),
  colour: text("colour"),
  plateNumber: z
    .string()
    .transform(normalisePlate)
    .refine((p) => PLATE_REGEX.test(p), "plateNumber must be a valid Indian registration number, e.g. MH12AB1234"),
  // Passenger seats, excluding the driver.
  seatCapacity: z.number().int().min(1).max(8),
});

export const updateVehicleSchema = createVehicleSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Provide at least one field to update");

export const docTypeSchema = z.enum(["RC", "LICENCE"]);

export const reviewVehicleSchema = z
  .object({
    decision: z.enum(["APPROVED", "REJECTED"]),
    note: z.string().trim().max(500, "note must be at most 500 characters").optional(),
  })
  .refine((v) => v.decision !== "REJECTED" || Boolean(v.note), {
    message: "A note is required when rejecting a vehicle",
    path: ["note"],
  });

export const reviewQuerySchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).default("PENDING"),
});

export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;
export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;
export type ReviewVehicleInput = z.infer<typeof reviewVehicleSchema>;
export type ReviewQuery = z.infer<typeof reviewQuerySchema>;
