import type { Prisma } from "@prisma/client";
import { env } from "../config/env";
import type { TemplateName, TemplateVars } from "../modules/notifications/templates";

// Queues one email by writing an OutboxEvent row inside the caller's
// transaction — same rule as writeAuditLog: the email exists if and only if
// the change that triggered it committed. Nothing is sent from here; the
// notifications relay picks the row up afterward.
export async function enqueueEmail<T extends TemplateName>(
  tx: Prisma.TransactionClient,
  template: T,
  toEmail: string,
  vars: TemplateVars[T],
) {
  if (!env.NOTIFICATIONS_ENABLED) {
    return;
  }
  await tx.outboxEvent.create({
    data: { template, toEmail, vars: vars as unknown as Prisma.InputJsonValue },
  });
}
