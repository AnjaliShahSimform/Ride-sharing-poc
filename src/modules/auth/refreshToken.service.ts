import { createHash, randomBytes } from "node:crypto";
import ms from "ms";
import { env } from "../../config/env";
import { UnauthenticatedError } from "../../lib/AppError";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";

// The cookie holds an opaque random value; only its SHA-256 is stored, so a DB
// leak yields nothing usable. Validity is decided by the row, which is what
// makes a refresh token revocable (unlike the stateless access JWT).
const hash = (raw: string) => createHash("sha256").update(raw).digest("hex");
const newRaw = () => randomBytes(32).toString("base64url");
const expiryFromNow = () => new Date(Date.now() + ms(env.REFRESH_TOKEN_EXPIRES_IN as ms.StringValue));

export async function issue(userId: string): Promise<string> {
  const raw = newRaw();
  await prisma.refreshToken.create({ data: { userId, tokenHash: hash(raw), expiresAt: expiryFromNow() } });
  return raw;
}

export async function deleteExpired(userId: string) {
  await prisma.refreshToken.deleteMany({ where: { userId, expiresAt: { lt: new Date() } } });
}

export async function revokeByRaw(raw: string) {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hash(raw), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// Returns the owning user plus a new refresh token — or no new token when `raw`
// was rotated a moment ago by a concurrent request (see the grace branch).
// Throws UnauthenticatedError for anything else.
export async function rotate(raw: string): Promise<{ userId: string; refreshToken?: string }> {
  const tokenHash = hash(raw);
  const now = new Date();

  // One conditional UPDATE decides the winner under Postgres's row lock, so two
  // concurrent refreshes with the same token can't both rotate it. The new row
  // is inserted in the same transaction: no window where the old token is
  // revoked and its replacement doesn't exist.
  const won = await prisma.$transaction(async (tx) => {
    const claimed = await tx.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: now } },
      data: { revokedAt: now, rotatedAt: now },
    });
    if (claimed.count === 0) return null;

    const row = await tx.refreshToken.findUniqueOrThrow({ where: { tokenHash } });
    const next = newRaw();
    await tx.refreshToken.create({
      data: { userId: row.userId, tokenHash: hash(next), expiresAt: expiryFromNow() },
    });
    return { userId: row.userId, refreshToken: next };
  });
  if (won) return won;

  const row = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  // Unknown, expired, or revoked by logout / a reuse sweep (rotatedAt unset):
  // plainly dead. Only a token that was *spent by a refresh* can be a race or a replay.
  if (!row || row.expiresAt <= now || !row.rotatedAt) {
    throw new UnauthenticatedError("Invalid or expired refresh token");
  }

  // Rotated a moment ago: almost certainly another tab refreshing at the same
  // time. The winning tab's new refresh cookie is already in the shared jar, so
  // hand back only an access token and leave the refresh cookie alone.
  if (now.getTime() - row.rotatedAt.getTime() <= env.REFRESH_REUSE_GRACE_SECONDS * 1000) {
    return { userId: row.userId };
  }

  // Rotated long ago and presented again: someone is replaying a stolen token.
  // We can't tell which party holds the newer one, so end every session.
  await prisma.refreshToken.updateMany({
    where: { userId: row.userId, revokedAt: null },
    data: { revokedAt: now },
  });
  logger.warn({ userId: row.userId }, "Refresh token reuse detected; all refresh tokens revoked");
  throw new UnauthenticatedError("Invalid or expired refresh token");
}
