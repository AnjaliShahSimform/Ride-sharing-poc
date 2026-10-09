import { z } from "zod";

export const auditLogQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(50),
});

export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
