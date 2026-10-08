import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../../src/app";

describe("CORS", () => {
  it("reflects the configured frontend origin with credentials enabled", async () => {
    const res = await request(app).get("/health").set("Origin", "http://localhost:5173");

    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("does not reflect an unrecognized origin", async () => {
    const res = await request(app).get("/health").set("Origin", "http://evil.example.com");

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
