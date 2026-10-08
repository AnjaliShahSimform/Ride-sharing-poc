import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, ApiError } from "./api";

describe("apiFetch", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("always sends credentials so the auth cookie is included", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ user: { id: "1" } }) } as Response);

    await apiFetch("/api/auth/me");

    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ credentials: "include" }));
  });

  it("attaches the CSRF header on a POST request", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({}) } as Response);

    await apiFetch("/api/rides", { method: "POST", body: { foo: "bar" } });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers["x-requested-with"]).toBe("XMLHttpRequest");
  });

  it("does not attach the CSRF header on a GET request", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({}) } as Response);

    await apiFetch("/api/rides/search");

    const [, init] = vi.mocked(fetch).mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers["x-requested-with"]).toBeUndefined();
  });

  it("throws ApiError with the server's message on a non-2xx response", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "ValidationError", message: "Bad input" }),
    } as Response);

    await expect(apiFetch("/api/rides", { method: "POST", body: {} })).rejects.toThrow(ApiError);
  });

  it("builds a readable message from the backend's Zod { error, details } shape when there is no message field", async () => {
    // This is the real shape src/middleware/errorHandler.ts sends for a ZodError:
    // { error: "ValidationError", details: err.flatten().fieldErrors }, e.g.
    // from rides.schemas.ts's departureTime refine.
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: "ValidationError",
        details: { departureTime: ["departureTime must be in the future"] },
      }),
    } as Response);

    await expect(apiFetch("/api/rides", { method: "POST", body: {} })).rejects.toThrow(
      "departureTime must be in the future",
    );
  });

  it("joins multiple field errors from the details shape into one message", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: "ValidationError",
        details: {
          originLat: ["Number must be greater than or equal to -90"],
          totalSeats: ["Number must be greater than 0"],
        },
      }),
    } as Response);

    await expect(apiFetch("/api/rides", { method: "POST", body: {} })).rejects.toThrow(
      "Number must be greater than or equal to -90 Number must be greater than 0",
    );
  });

  it("still prefers an explicit message field over details when both are present", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "ConflictError", message: "Ride is no longer available" }),
    } as Response);

    await expect(apiFetch("/api/rides/1/cancel", { method: "PATCH" })).rejects.toThrow(
      "Ride is no longer available",
    );
  });
});
