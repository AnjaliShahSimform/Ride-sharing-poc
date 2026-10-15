import bcrypt from "bcryptjs";
import { ConflictError, UnauthenticatedError } from "../../lib/AppError";
import { signToken } from "../../lib/jwt";
import { prisma } from "../../lib/prisma";
import * as refreshTokens from "./refreshToken.service";
import type { LoginInput, SignupInput } from "./auth.schemas";

const SALT_ROUNDS = 10;

function toPublicUser(user: { id: string; name: string; email: string; phone: string; roles: string[] }) {
  // Never let passwordHash leave the service layer, under any circumstance.
  return { id: user.id, name: user.name, email: user.email, phone: user.phone, roles: user.roles };
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

  const token = signToken({ sub: user.id, roles: user.roles });
  const refreshToken = await refreshTokens.issue(user.id);
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

  const token = signToken({ sub: user.id, roles: user.roles });
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
  const token = signToken({ sub: user.id, roles: user.roles });
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
