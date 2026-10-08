import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "../../src/lib/AppError";
import { requireCsrfHeader } from "../../src/middleware/csrf";

function fakeReq(method: string, headers: Record<string, string> = {}): Request {
  return { method, headers } as unknown as Request;
}

describe("requireCsrfHeader", () => {
  it("throws ForbiddenError for a POST without the header", () => {
    const req = fakeReq("POST");
    expect(() => requireCsrfHeader(req, {} as Response, vi.fn())).toThrow(ForbiddenError);
  });

  it("calls next() for a POST with the correct header", () => {
    const req = fakeReq("POST", { "x-requested-with": "XMLHttpRequest" });
    const next = vi.fn();
    requireCsrfHeader(req, {} as Response, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("throws ForbiddenError for a PATCH without the header", () => {
    const req = fakeReq("PATCH");
    expect(() => requireCsrfHeader(req, {} as Response, vi.fn())).toThrow(ForbiddenError);
  });

  it("calls next() for a GET without the header", () => {
    const req = fakeReq("GET");
    const next = vi.fn();
    requireCsrfHeader(req, {} as Response, next);
    expect(next).toHaveBeenCalledOnce();
  });
});
