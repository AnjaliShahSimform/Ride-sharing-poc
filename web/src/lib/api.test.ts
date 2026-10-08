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
});
