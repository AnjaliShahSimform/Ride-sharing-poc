import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { env } from "../../config/env";
import { ConflictError, UnauthenticatedError } from "../../lib/AppError";
import { signToken } from "../../lib/jwt";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import * as phoneVerification from "./phoneVerification.service";
import * as refreshTokens from "./refreshToken.service";
import type { LoginInput, SignupInput, UpdateProfileInput } from "./auth.schemas";

const SALT_ROUNDS = 10;

type UserRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  roles: string[];
  createdAt: Date;
  phoneVerifiedAt: Date | null;
};

function toPublicUser(user: UserRow) {
  // Never let passwordHash leave the service layer, under any circumstance.
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    roles: user.roles,
    createdAt: user.createdAt,
    phoneVerified: phoneVerification.isPhoneVerified(user),
  };
}

// Every access token carries the verification state, so requireAuth can gate
// without a database read. Re-signed whenever that state changes.
function signSessionToken(user: Pick<UserRow, "id" | "roles" | "phoneVerifiedAt">) {
  return signToken({ sub: user.id, roles: user.roles, phoneVerified: phoneVerification.isPhoneVerified(user) });
}

export async function signup(input: SignupInput) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new ConflictError("An account with this email already exists");
  }

  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      phone: input.phone,
      passwordHash,
      roles: [input.role],
    },
  });

  const token = signSessionToken(user);
  const refreshToken = await refreshTokens.issue(user.id);

  // Best effort: the account exists either way. If the SMS fails the user lands
  // on the verify screen and presses Resend (the cause is already logged).
  if (env.REQUIRE_PHONE_VERIFICATION) {
    await phoneVerification
      .sendCode(user.id, user.phone)
      .catch((err) => logger.warn({ err, userId: user.id }, "Signup verification code was not sent"));
  }
  return { user: toPublicUser(user), token, refreshToken };
}

export async function login(input: LoginInput) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  // Deliberately the same error for "no such user" and "wrong password" —
  // distinguishing them tells an attacker which emails are registered.
  const invalidCredentials = new UnauthenticatedError("Invalid email or password");

  if (!user) {
    throw invalidCredentials;
  }

  const passwordMatches = await bcrypt.compare(input.password, user.passwordHash);
  if (!passwordMatches) {
    throw invalidCredentials;
  }

  const token = signSessionToken(user);
  await refreshTokens.deleteExpired(user.id);
  const refreshToken = await refreshTokens.issue(user.id);
  return { user: toPublicUser(user), token, refreshToken };
}

// `refreshToken` is undefined when the presented token lost a race with a
// concurrent refresh (see refreshToken.service.ts) — the caller then keeps the
// refresh cookie it already has.
export async function refresh(rawRefreshToken: string | undefined) {
  if (!rawRefreshToken) {
    throw new UnauthenticatedError("Refresh token required");
  }
  const { userId, refreshToken } = await refreshTokens.rotate(rawRefreshToken);

  // Roles come from the DB, not the old JWT, so role changes apply on refresh.
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new UnauthenticatedError("User no longer exists");
  }
  const token = signSessionToken(user);
  return { user: toPublicUser(user), token, refreshToken };
}

export async function logout(rawRefreshToken: string | undefined) {
  if (rawRefreshToken) {
    await refreshTokens.revokeByRaw(rawRefreshToken);
  }
}

export async function getById(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new UnauthenticatedError("User no longer exists");
  }
  return toPublicUser(user);
}

export async function updateProfile(userId: string, input: UpdateProfileInput) {
  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { name: input.name },
    });
    return toPublicUser(user);
  } catch (err) {
    // P2025: the row was deleted after the JWT was issued.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      throw new UnauthenticatedError("User no longer exists");
    }
    throw err;
  }
}

export async function verifyPhone(userId: string, code: string) {
  await phoneVerification.verifyCode(userId, code);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  // New token: the old one still says phoneVerified:false.
  return { user: toPublicUser(user), token: signSessionToken(user) };
}

export function resendPhoneCode(userId: string) {
  return phoneVerification.resend(userId);
}
