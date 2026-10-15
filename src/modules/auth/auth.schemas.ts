import { z } from "zod";

export const signupSchema = z.object({
  name: z.string().min(1, "name is required"),
  email: z.string().email(),
  phone: z.string().min(7, "phone must be a valid number"),
  password: z.string().min(8, "password must be at least 8 characters"),
  role: z.enum(["DRIVER", "RIDER"]),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "password is required"),
});

// Only name and phone are self-editable. Email is the login identity and roles
// are an authorization decision, so neither is accepted — and `.strict()` turns
// an attempt to send them into a 400 rather than a silent no-op.
export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1, "name is required").max(100).optional(),
    phone: z.string().trim().min(7, "phone must be a valid number").max(20).optional(),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.phone !== undefined, {
    message: "provide a name or a phone to update",
    path: ["name"],
  });

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
