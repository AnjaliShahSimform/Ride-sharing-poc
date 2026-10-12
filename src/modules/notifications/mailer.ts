import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../../config/env";

let transporter: Transporter | undefined;

// Lazy so importing this module (e.g. via app.ts) never opens a socket;
// pooled so a burst of emails reuses SMTP connections.
function getTransporter(): Transporter {
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER && env.SMTP_PASS ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    pool: true,
  });
  return transporter;
}

export async function sendMail(message: { to: string; subject: string; text: string; html: string }) {
  await getTransporter().sendMail({ from: env.EMAIL_FROM, ...message });
}

// A 5xx SMTP reply (bad mailbox, rejected sender, bad credentials) or an
// invalid-envelope error will fail identically on every retry, so those go
// straight to the dead-letter queue. Everything else — 4xx replies, timeouts,
// refused connections — is assumed transient and worth retrying.
export function isPermanentMailError(err: unknown): boolean {
  const { responseCode, code } = err as { responseCode?: number; code?: string };
  if (typeof responseCode === "number") {
    return responseCode >= 500 && responseCode < 600;
  }
  return code === "EENVELOPE" || code === "EMESSAGE";
}

export async function closeMailer() {
  transporter?.close();
  transporter = undefined;
}
