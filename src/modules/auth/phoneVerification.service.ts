import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env";
import { ConflictError, TooManyRequestsError, UnauthenticatedError, ValidationError } from "../../lib/AppError";
import { prisma } from "../../lib/prisma";
import { sendSms } from "../../lib/sms";

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
export const RESEND_COOLDOWN_SECONDS = 60;
const MAX_SENDS_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;

// Verified when: the feature is off, the account is an ADMIN (created directly
// in the database, never through signup), or the phone was confirmed.
export function isPhoneVerified(user: { phoneVerifiedAt: Date | null; roles: string[] }): boolean {
  return !env.REQUIRE_PHONE_VERIFICATION || user.roles.includes("ADMIN") || user.phoneVerifiedAt !== null;
}

// A 6-digit code has only a million values, so a plain hash would be reversed
// in milliseconds if the table leaked. Keying it with the server secret (and
// the user id) makes the stored value useless without that secret.
function hashCode(userId: string, code: string): string {
  return createHmac("sha256", env.JWT_SECRET).update(`${userId}:${code}`).digest("hex");
}

function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

// Creates (or replaces) the user's code, enforcing the resend cooldown and the
// hourly cap, then texts it. The DB write commits BEFORE the SMS goes out, so a
// provider failure leaves a valid code in place and the user simply resends
// (after the cooldown). Rows for the same user are serialised by the row lock.
export async function sendCode(userId: string, phone: string): Promise<void> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "PhoneVerification" WHERE "userId" = ${userId} FOR UPDATE`;
    const existing = await tx.phoneVerification.findUnique({ where: { userId } });

    let sendCount = 1;
    let sendWindowStart = now;
    if (existing) {
      const sinceLastMs = now.getTime() - existing.lastSentAt.getTime();
      if (sinceLastMs < RESEND_COOLDOWN_SECONDS * 1000) {
        const wait = Math.ceil((RESEND_COOLDOWN_SECONDS * 1000 - sinceLastMs) / 1000);
        throw new TooManyRequestsError(`Please wait ${wait} seconds before requesting another code`, wait);
      }
      if (now.getTime() - existing.sendWindowStart.getTime() < HOUR_MS) {
        if (existing.sendCount >= MAX_SENDS_PER_HOUR) {
          const windowWait = Math.ceil((existing.sendWindowStart.getTime() + HOUR_MS - now.getTime()) / 1000);
          throw new TooManyRequestsError("Too many codes requested. Please try again in an hour.", windowWait);
        }
        sendCount = existing.sendCount + 1;
        sendWindowStart = existing.sendWindowStart;
      }
    }

    const data = {
      codeHash: hashCode(userId, code),
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
      attempts: 0,
      lastSentAt: now,
      sendCount,
      sendWindowStart,
    };
    await tx.phoneVerification.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  });

  await sendSms(phone, `Your RideShare verification code is ${code}. It expires in 10 minutes.`);
}

export async function resend(userId: string): Promise<{ resendAfterSeconds: number }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new UnauthenticatedError("User no longer exists");
  }
  if (isPhoneVerified(user)) {
    throw new ConflictError("Your phone number is already verified");
  }
  await sendCode(user.id, user.phone);
  return { resendAfterSeconds: RESEND_COOLDOWN_SECONDS };
}

type Outcome =
  | { status: "OK" }
  | { status: "NO_CODE" | "EXPIRED" | "LOCKED" }
  | { status: "WRONG"; attemptsLeft: number };

// Checks a code. The whole decision runs under the row lock, so ten parallel
// wrong guesses are counted one by one and can't slip past MAX_ATTEMPTS (same
// idea as bookSeat's last-seat lock). A wrong guess must COMMIT its attempt
// increment even though the request then fails — hence the outcome is returned
// out of the transaction and only turned into an error afterwards (throwing
// inside would roll the increment back).
export async function verifyCode(userId: string, code: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new UnauthenticatedError("User no longer exists");
  }
  if (isPhoneVerified(user)) {
    throw new ConflictError("Your phone number is already verified");
  }

  const now = new Date();
  const outcome = await prisma.$transaction(async (tx): Promise<Outcome> => {
    await tx.$queryRaw`SELECT id FROM "PhoneVerification" WHERE "userId" = ${userId} FOR UPDATE`;
    const row = await tx.phoneVerification.findUnique({ where: { userId } });
    if (!row) return { status: "NO_CODE" };
    if (row.expiresAt <= now) return { status: "EXPIRED" };
    if (row.attempts >= MAX_ATTEMPTS) return { status: "LOCKED" };

    if (!hashesMatch(row.codeHash, hashCode(userId, code))) {
      await tx.phoneVerification.update({ where: { userId }, data: { attempts: { increment: 1 } } });
      return { status: "WRONG", attemptsLeft: MAX_ATTEMPTS - (row.attempts + 1) };
    }

    await tx.user.update({ where: { id: userId }, data: { phoneVerifiedAt: now } });
    await tx.phoneVerification.delete({ where: { userId } });
    return { status: "OK" };
  });

  switch (outcome.status) {
    case "OK":
      return;
    case "NO_CODE":
      throw new ValidationError("No active code. Request a new one.");
    case "EXPIRED":
      throw new ValidationError("That code has expired. Request a new one.");
    case "LOCKED":
      throw new TooManyRequestsError("Too many wrong attempts. Request a new code.");
    case "WRONG":
      throw new ValidationError(
        outcome.attemptsLeft > 0
          ? `Incorrect code. ${outcome.attemptsLeft} attempt${outcome.attemptsLeft === 1 ? "" : "s"} left.`
          : "Incorrect code. Request a new one.",
      );
  }
}
