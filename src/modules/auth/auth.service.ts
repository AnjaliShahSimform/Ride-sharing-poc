import { Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { ConflictError, UnauthenticatedError } from "../../lib/AppError";
import { signToken } from "../../lib/jwt";
import { prisma } from "../../lib/prisma";
import type { LoginInput, SignupInput } from "./auth.schemas";

const SALT_ROUNDS = 10;

// Every user can act as both driver and rider — there is no separate
// "driver account" vs "rider account". See design spec §2.
const DEFAULT_ROLES: Role[] = [Role.DRIVER, Role.RIDER];

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
      roles: DEFAULT_ROLES,
    },
  });

  const token = signToken({ sub: user.id, roles: user.roles });
  return { user: toPublicUser(user), token };
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
  return { user: toPublicUser(user), token };
}

export async function getById(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new UnauthenticatedError("User no longer exists");
  }
  return toPublicUser(user);
}
