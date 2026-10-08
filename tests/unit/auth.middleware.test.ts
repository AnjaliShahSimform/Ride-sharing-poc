import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { ForbiddenError, UnauthenticatedError } from "../../src/lib/AppError";
import { signToken } from "../../src/lib/jwt";
import { requireAuth, requireRole } from "../../src/middleware/auth.middleware";

function fakeReq(overrides: Partial<Request> = {}): Request {
  return { cookies: {}, ...overrides } as Request;
}

describe("requireAuth", () => {
  it("throws UnauthenticatedError when there is no token cookie", () => {
    const req = fakeReq();
    expect(() => requireAuth(req, {} as Response, vi.fn())).toThrow(UnauthenticatedError);
  });

  it("throws UnauthenticatedError for a malformed token", () => {
    const req = fakeReq({ cookies: { token: "not-a-real-token" } });
    expect(() => requireAuth(req, {} as Response, vi.fn())).toThrow(UnauthenticatedError);
  });

  it("attaches the decoded payload to req.user and calls next() for a valid token", () => {
    const token = signToken({ sub: "user-1", roles: ["DRIVER"] });
    const req = fakeReq({ cookies: { token } });
    const next = vi.fn();

    requireAuth(req, {} as Response, next);

    expect(req.user).toMatchObject({ sub: "user-1", roles: ["DRIVER"] });
    expect(next).toHaveBeenCalledOnce();
  });
});

describe("requireRole", () => {
  it("throws ForbiddenError when the user lacks every allowed role", () => {
    const req = fakeReq({ user: { sub: "user-1", roles: ["RIDER"] } });
    expect(() => requireRole("DRIVER")(req, {} as Response, vi.fn())).toThrow(ForbiddenError);
  });

  it("calls next() when the user has one of the allowed roles", () => {
    const req = fakeReq({ user: { sub: "user-1", roles: ["DRIVER", "RIDER"] } });
    const next = vi.fn();

    requireRole("DRIVER")(req, {} as Response, next);

    expect(next).toHaveBeenCalledOnce();
  });
});
