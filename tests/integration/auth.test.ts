import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app";
import { env } from "../../src/config/env";
import { prisma } from "../../src/lib/prisma";
import { resetDb } from "./testDb";
import ms from "ms";

beforeEach(resetDb);

const validSignup = {
  name: "Anjali Rider",
  email: "anjali@example.com",
  phone: "9999999999",
  password: "correct-horse",
};

describe("POST /api/auth/signup", () => {
  it("creates a user and sets an auth cookie", async () => {
    const res = await request(app).post("/api/auth/signup").send(validSignup);

    expect(res.status).toBe(201);
    expect(res.body.token).toBeUndefined();
    expect(res.headers["set-cookie"]?.[0]).toMatch(/^token=/);
    expect(res.body.user).toMatchObject({
      email: validSignup.email,
      name: validSignup.name,
      roles: expect.arrayContaining(["DRIVER", "RIDER"]),
    });
  });

  it("never returns the password hash", async () => {
    const res = await request(app).post("/api/auth/signup").send(validSignup);

    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it("rejects a second signup with the same email", async () => {
    await request(app).post("/api/auth/signup").send(validSignup);
    const res = await request(app).post("/api/auth/signup").send(validSignup);

    expect(res.status).toBe(409);
  });

  it("rejects an invalid email before it reaches the database", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ ...validSignup, email: "not-an-email" });

    expect(res.status).toBe(400);
    const usersCreated = await prisma.user.count();
    expect(usersCreated).toBe(0);
  });

  it("rejects a password shorter than 8 characters", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ ...validSignup, password: "short" });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/login", () => {
  it("sets an auth cookie for correct credentials", async () => {
    await request(app).post("/api/auth/signup").send(validSignup);

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: validSignup.email, password: validSignup.password });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeUndefined();
    expect(res.headers["set-cookie"]?.[0]).toMatch(/^token=/);
  });

  it("sets the cookie's Max-Age to match JWT_EXPIRES_IN", async () => {
    await request(app).post("/api/auth/signup").send(validSignup);

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: validSignup.email, password: validSignup.password });

    const setCookie = res.headers["set-cookie"]?.[0] ?? "";
    const expectedSeconds = Math.floor(ms(env.JWT_EXPIRES_IN) / 1000);
    expect(setCookie).toMatch(new RegExp(`Max-Age=${expectedSeconds}`));
  });

  it("rejects a wrong password with 401", async () => {
    await request(app).post("/api/auth/signup").send(validSignup);

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: validSignup.email, password: "wrong-password" });

    expect(res.status).toBe(401);
  });

  it("rejects an email that was never signed up with 401", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@example.com", password: "whatever123" });

    expect(res.status).toBe(401);
  });
});
