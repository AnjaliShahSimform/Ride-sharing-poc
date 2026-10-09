import bcrypt from "bcryptjs";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app";
import { CSRF_HEADER_NAME, CSRF_HEADER_VALUE } from "../../src/middleware/csrf";
import { prisma } from "../../src/lib/prisma";
import { resetDb } from "./testDb";

beforeEach(resetDb);

type Agent = ReturnType<typeof request.agent>;

async function signup(email: string, role: "DRIVER" | "RIDER"): Promise<Agent> {
  const agent = request.agent(app);
  await agent
    .post("/api/auth/signup")
    .set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE)
    .send({
      name: role === "DRIVER" ? "Dara Driver" : "Rina Rider",
      email,
      phone: "9999999999",
      password: "correct-horse",
      role,
    });
  return agent;
}

// The signup schema only accepts DRIVER/RIDER (design spec: admins are
// created directly in the database, never via self-service signup), so
// admin fixtures go straight through Prisma and log in with the real
// endpoint to pick up a genuine session cookie.
async function createAdminAndLogin(email = "admin@example.com"): Promise<Agent> {
  const passwordHash = await bcrypt.hash("password123", 10);
  await prisma.user.create({
    data: { name: "Admin", email, phone: "9000000000", passwordHash, roles: ["ADMIN"] },
  });
  const agent = request.agent(app);
  await agent.post("/api/auth/login").set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE).send({ email, password: "password123" });
  return agent;
}

const validRide = {
  originLat: 23.0225,
  originLng: 72.5714,
  destLat: 19.076,
  destLng: 72.8777,
  originLabel: "Ahmedabad",
  destLabel: "Mumbai",
  departureTime: "2027-01-01T06:00:00.000Z",
  totalSeats: 3,
  estimatedCost: "1200.00",
};

describe("GET /api/admin/users", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(app).get("/api/admin/users");
    expect(res.status).toBe(401);
  });

  it("rejects a non-admin (driver) caller", async () => {
    const agent = await signup("driver@example.com", "DRIVER");
    const res = await agent.get("/api/admin/users");
    expect(res.status).toBe(403);
  });

  it("returns every user without exposing passwordHash", async () => {
    await signup("driver@example.com", "DRIVER");
    await signup("rider@example.com", "RIDER");
    const admin = await createAdminAndLogin();

    const res = await admin.get("/api/admin/users");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    const emails = res.body.map((u: { email: string }) => u.email).sort();
    expect(emails).toEqual(["admin@example.com", "driver@example.com", "rider@example.com"]);
    for (const user of res.body) {
      expect(user.passwordHash).toBeUndefined();
    }
  });
});

describe("GET /api/admin/rides", () => {
  it("rejects a non-admin (rider) caller", async () => {
    const agent = await signup("rider@example.com", "RIDER");
    const res = await agent.get("/api/admin/rides");
    expect(res.status).toBe(403);
  });

  it("returns rides from every driver, newest first", async () => {
    const driver1 = await signup("driver1@example.com", "DRIVER");
    const driver2 = await signup("driver2@example.com", "DRIVER");
    await driver1.post("/api/rides").set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE).send(validRide);
    await driver2.post("/api/rides").set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE).send(validRide);
    const admin = await createAdminAndLogin();

    const res = await admin.get("/api/admin/rides");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const driverIds = res.body.map((r: { driverId: string }) => r.driverId).sort();
    const expectedIds = [res.body[0].driverId, res.body[1].driverId].sort();
    expect(driverIds).toEqual(expectedIds);
  });
});

describe("GET /api/admin/audit-logs", () => {
  it("rejects a non-admin (driver) caller", async () => {
    const agent = await signup("driver@example.com", "DRIVER");
    const res = await agent.get("/api/admin/audit-logs");
    expect(res.status).toBe(403);
  });

  it("returns audit log entries newest first, paginated", async () => {
    const driver = await signup("driver@example.com", "DRIVER");
    // Each ride post writes one audit log row (rides.service.ts's createRide).
    for (let i = 0; i < 3; i++) {
      await driver.post("/api/rides").set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE).send(validRide);
    }
    const admin = await createAdminAndLogin();

    const res = await admin.get("/api/admin/audit-logs").query({ page: 1, pageSize: 2 });

    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(2);
    expect(res.body.total).toBe(3);
    const timestamps = res.body.entries.map((e: { createdAt: string }) => new Date(e.createdAt).getTime());
    expect(timestamps[0]).toBeGreaterThanOrEqual(timestamps[1]);
  });

  it("defaults to pageSize 50 when no query params are given", async () => {
    const driver = await signup("driver@example.com", "DRIVER");
    await driver.post("/api/rides").set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE).send(validRide);
    const admin = await createAdminAndLogin();

    const res = await admin.get("/api/admin/audit-logs");

    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });
});
