import { z } from "zod";
import { normaliseIndianMobile } from "../../lib/phone";

export const signupSchema = z.object({
  name: z.string().min(1, "name is required"),
  email: z.string().email(),
  phone: z
    .string()
    .trim()
    .transform((value, ctx) => {
      const normalised = normaliseIndianMobile(value);
      if (!normalised) {
        ctx.addIssue({ code: "custom", message: "enter a valid 10-digit Indian mobile number" });
        return z.NEVER;
      }
      return normalised;
    }),
  password: z.string().min(8, "password must be at least 8 characters"),
  role: z.enum(["DRIVER", "RIDER"]),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "password is required"),
});

// Only the name is self-editable. The phone is fixed at signup (it is the number
// we verified), the email is the login identity, and roles are an authorization
// decision. `.strict()` turns an attempt to send any other key into a 400
// instead of a silent no-op.
export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1, "name is required").max(100),
  })
  .strict();

export const verifyPhoneSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "code must be 6 digits"),
});

export type VerifyPhoneInput = z.infer<typeof verifyPhoneSchema>;
export type SignupInput =z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
