# Backend Cookie Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace body-returned JWT auth with `httpOnly` cookie auth, add `GET /api/auth/me` and `POST /api/auth/logout`, and add a CSRF mitigation — the backend half of adding a frontend to this API.

**Architecture:** `src/lib/authCookie.ts` centralizes cookie name/options so signup, login, and logout can't drift out of sync with each other. `requireAuth` switches from reading `Authorization: Bearer` to reading the cookie. A new `requireCsrfHeader` middleware, applied globally, rejects mutating requests missing a custom header — the chosen lightweight defense against the CSRF exposure that coming `SameSite=None` requirement creates (full reasoning in the spec, §3).

**Tech Stack:** Express, `cookie-parser`, `ms` (to keep the cookie's `maxAge` in sync with `JWT_EXPIRES_IN`), existing Zod/Prisma/Vitest/Supertest stack — no new frameworks.

**Spec:** [docs/superpowers/specs/2026-10-08-frontend-cookie-auth-design.md](../specs/2026-10-08-frontend-cookie-auth-design.md) (§3, §4 — this plan implements the backend portion only; §5 onward is Plan 2)

## Global Constraints

- Cookie name is `token` (exported as `AUTH_COOKIE_NAME`) — never hardcode the string `"token"` outside `src/lib/authCookie.ts`.
- Cookie options: `httpOnly: true` always; `secure: env.NODE_ENV === "production"`; `sameSite: "none"` in production, `"lax"` otherwise; `path: "/"`.
- Cookie `maxAge` must be derived from `ms(env.JWT_EXPIRES_IN)`, never a separate hardcoded duration.
- CSRF header is `X-Requested-With: XMLHttpRequest`, checked case-insensitively via Express's lowercased `req.headers`, required on `POST`/`PATCH`/`PUT`/`DELETE` only — never on `GET`.
- No JWT is ever returned in a response body anywhere, including `/me` and `/logout` — cookie-only, per the approved spec decision.
- `FRONTEND_ORIGIN` env var defaults to `http://localhost:5173` so local dev/tests work unconfigured.
- Every task follows TDD: write/run the failing test first, watch it fail for the stated reason, then implement.
- Reuse the existing `AppError` taxonomy (`ForbiddenError`, `UnauthenticatedError`) — do not add a new `AppError` subclass for CSRF or `/me` failures; both fit existing categories.

## Review Focus

- **Logout with no existing session.** `POST /api/auth/logout` must return `200` even when there's no cookie at all — it must not require `requireAuth` or throw. A test with zero prior signup/login hitting logout directly covers this.
- **`/me` with no or invalid session.** `GET /api/auth/me` must return `401` (via the same `requireAuth` used elsewhere), not crash, for a request with no cookie and for one with a garbage cookie value.
- **CSRF middleware must never block `GET`.** A middleware keyed on HTTP method is an easy off-by-one away from blocking reads too. A test asserting a `GET` request succeeds with *no* CSRF header at all is required, not just that `POST` without it fails.
- **Cookie `maxAge` must track `JWT_EXPIRES_IN` dynamically, not duplicate it.** A test computing the expected `Max-Age` from `ms(env.JWT_EXPIRES_IN)` (not a hardcoded number) catches a future regression where someone changes `JWT_EXPIRES_IN` and forgets the cookie would silently keep its old duration if hardcoded.
- **Signup must set the cookie too, not just login.** They're two separate controller functions edited independently — both need their own explicit cookie assertion, not just login's.

---

## Task 1: CORS — credentialed, specific origin

**Files:**
- Create: `tests/integration/cors.test.ts`
- Modify: `src/config/env.ts`
- Modify: `.env`
- Modify: `.env.example`
- Modify: `src/app.ts`

**Interfaces:**
- Produces: `env.FRONTEND_ORIGIN: string` (from `src/config/env.ts`'s existing `env` export) — consumed by this task's own `src/app.ts` change; no other task in this plan depends on it.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/cors.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/cors.test.ts`
Expected: FAIL — the current `app.use(cors())` (no options) reflects `Access-Control-Allow-Origin: *` for every origin and sets no `Access-Control-Allow-Credentials` header at all, so both assertions fail.

- [ ] **Step 3: Add `FRONTEND_ORIGIN` to the env schema**

In `src/config/env.ts`, add one field to `envSchema` right after `DIRECT_URL`:

```ts
  DIRECT_URL: z.string().min(1, "DIRECT_URL is required"),
  FRONTEND_ORIGIN: z.string().min(1).default("http://localhost:5173"),
```

- [ ] **Step 4: Add the env var to `.env` and `.env.example`**

In both `.env` and `.env.example`, add this line right after the `DIRECT_URL` line:

```
FRONTEND_ORIGIN=http://localhost:5173
```

- [ ] **Step 5: Update CORS config in `src/app.ts`**

Add the `env` import and change the `cors()` call:

```ts
import { env } from "./config/env";
```

(add this import alongside the other local imports, e.g. right after the `errorHandler` import line)

```ts
app.use(cors({ origin: env.FRONTEND_ORIGIN, credentials: true }));
```

(replaces the current `app.use(cors());` line)

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/integration/cors.test.ts`
Expected: PASS

- [ ] **Step 7: Run the full suite to confirm no regression**

Run: `npm test`
Expected: all existing tests still PASS — no other test inspects CORS headers.

- [ ] **Step 8: Commit**

```bash
git add tests/integration/cors.test.ts src/config/env.ts .env.example src/app.ts
git commit -m "feat: lock CORS to a configured frontend origin with credentials"
```

(`.env` is gitignored — do not `git add .env`.)

---

## Task 2: Cookie-based signup/login, `requireAuth` reads the cookie

This is the structural switch: every consumer of the old `Authorization: Bearer <token>` pattern moves to cookie-based auth via Supertest's `request.agent(app)`, which persists cookies across requests automatically. No CSRF header yet — that's Task 3, layered on top once this lands cleanly.

**Files:**
- Create: `src/lib/authCookie.ts`
- Modify: `src/middleware/auth.middleware.ts`
- Modify: `src/app.ts`
- Modify: `src/modules/auth/auth.controller.ts`
- Modify: `tests/unit/auth.middleware.test.ts`
- Modify: `tests/integration/auth.test.ts`
- Modify: `tests/integration/rides.test.ts`
- Modify: `package.json` (via `npm install`)

**Interfaces:**
- Produces (from `src/lib/authCookie.ts`): `AUTH_COOKIE_NAME: string`, `setAuthCookie(res: Response, token: string): void`, `clearAuthCookie(res: Response): void`. Task 4 imports `clearAuthCookie`.
- Consumes: `env.NODE_ENV`, `env.JWT_EXPIRES_IN` (already exist in `src/config/env.ts`).

- [ ] **Step 1: Write the failing unit test for cookie-based `requireAuth`**

Replace the full content of `tests/unit/auth.middleware.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/auth.middleware.test.ts`
Expected: FAIL. The current `requireAuth` reads `req.headers.authorization`; `fakeReq` no longer sets `headers` at all, so the first two `requireAuth` tests fail (likely a `TypeError` reading `req.headers.authorization` rather than a clean assertion mismatch — that's still the expected failure, it confirms the implementation hasn't been updated to read cookies yet). The `requireRole` tests are unaffected and should still pass — `requireRole` never reads `req.headers`.

- [ ] **Step 3: Install new dependencies**

```bash
npm install cookie-parser ms
npm install --save-dev @types/cookie-parser @types/ms
```

- [ ] **Step 4: Create `src/lib/authCookie.ts`**

```ts
import type { Response } from "express";
import ms from "ms";
import { env } from "../config/env";

export const AUTH_COOKIE_NAME = "token";

function cookieOptions() {
  const isProd = env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: (isProd ? "none" : "lax") as "none" | "lax",
    path: "/",
  };
}

export function setAuthCookie(res: Response, token: string) {
  res.cookie(AUTH_COOKIE_NAME, token, { ...cookieOptions(), maxAge: ms(env.JWT_EXPIRES_IN) });
}

export function clearAuthCookie(res: Response) {
  res.clearCookie(AUTH_COOKIE_NAME, cookieOptions());
}
```

- [ ] **Step 5: Update `requireAuth` to read the cookie**

Replace the full content of `src/middleware/auth.middleware.ts`:

```ts
import type { NextFunction, Request, Response } from "express";
import { ForbiddenError, UnauthenticatedError } from "../lib/AppError";
import { AUTH_COOKIE_NAME } from "../lib/authCookie";
import { verifyToken } from "../lib/jwt";

// Authentication: who are you? Every route but signup/login needs this.
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[AUTH_COOKIE_NAME];
  if (!token) {
    throw new UnauthenticatedError();
  }

  try {
    req.user = verifyToken(token);
  } catch {
    throw new UnauthenticatedError("Invalid or expired token");
  }

  next();
}

// Authorization (RBAC): given who you are, are you allowed to call this
// ROUTE at all? This is separate from ownership checks (§ service layer),
// which decide whether you're allowed to act on this specific RECORD.
export function requireRole(...allowed: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const roles = req.user?.roles ?? [];
    const hasRole = allowed.some((role) => roles.includes(role));
    if (!hasRole) {
      throw new ForbiddenError(`Requires one of roles: ${allowed.join(", ")}`);
    }
    next();
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/unit/auth.middleware.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 7: Write the failing integration test for cookie-based signup/login**

Replace the full content of `tests/integration/auth.test.ts`:

```ts
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
```

- [ ] **Step 8: Run test to verify it fails**

Run: `npx vitest run tests/integration/auth.test.ts`
Expected: FAIL — the controller still returns `{ user, token }` in the JSON body and never calls `res.cookie(...)`, so the `token` presence/`Set-Cookie`/`Max-Age` assertions fail.

- [ ] **Step 9: Add `cookie-parser` middleware to `src/app.ts`**

Add the import alongside the other third-party middleware imports:

```ts
import cookieParser from "cookie-parser";
```

Add `app.use(cookieParser());` right after the CORS line and before `app.use(express.json());`:

```ts
app.use(cors({ origin: env.FRONTEND_ORIGIN, credentials: true }));
app.use(cookieParser());
app.use(express.json());
```

- [ ] **Step 10: Update `auth.controller.ts` to set the cookie**

Replace the full content of `src/modules/auth/auth.controller.ts`:

```ts
import type { Request, Response } from "express";
import { setAuthCookie } from "../../lib/authCookie";
import * as authService from "./auth.service";

export async function signupHandler(req: Request, res: Response) {
  const { user, token } = await authService.signup(req.body);
  setAuthCookie(res, token);
  res.status(201).json({ user });
}

export async function loginHandler(req: Request, res: Response) {
  const { user, token } = await authService.login(req.body);
  setAuthCookie(res, token);
  res.status(200).json({ user });
}
```

- [ ] **Step 11: Run test to verify it passes**

Run: `npx vitest run tests/integration/auth.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 12: Run the full suite — confirm `rides.test.ts` is now broken**

Run: `npm test`
Expected: `tests/integration/rides.test.ts` now FAILS. Its helpers extract `res.body.token` (now `undefined`) and set it as a `Bearer` header, which `requireAuth` no longer reads at all — every authenticated request in that file now gets `401`. This is the expected, direct consequence of this task's change, not a separate bug — fixing it is the next step, in this same task.

- [ ] **Step 13: Rewrite `rides.test.ts` to use a cookie-persisting agent**

Replace the full content of `tests/integration/rides.test.ts`:

```ts
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app";
import { resetDb } from "./testDb";

beforeEach(resetDb);

type Agent = ReturnType<typeof request.agent>;

async function signupDriver(email = "dara@example.com"): Promise<Agent> {
  const agent = request.agent(app);
  await agent.post("/api/auth/signup").send({
    name: "Dara Driver",
    email,
    phone: "9999999999",
    password: "correct-horse",
  });
  return agent;
}

async function createRide(agent: Agent) {
  const res = await agent.post("/api/rides").send(validRide);
  return res.body.id as string;
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

describe("POST /api/rides", () => {
  it("creates a ride for an authenticated driver", async () => {
    const agent = await signupDriver();

    const res = await agent.post("/api/rides").send(validRide);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      originLabel: "Ahmedabad",
      destLabel: "Mumbai",
      totalSeats: 3,
      seatsAvailable: 3,
      status: "SCHEDULED",
    });
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(app).post("/api/rides").send(validRide);
    expect(res.status).toBe(401);
  });

  it("rejects a departureTime in the past", async () => {
    const agent = await signupDriver();

    const res = await agent.post("/api/rides").send({ ...validRide, departureTime: "2020-01-01T06:00:00.000Z" });

    expect(res.status).toBe(400);
  });

  it("rejects totalSeats <= 0", async () => {
    const agent = await signupDriver();

    const res = await agent.post("/api/rides").send({ ...validRide, totalSeats: 0 });

    expect(res.status).toBe(400);
  });
});

describe("GET /api/rides/search", () => {
  // Ahmedabad -> Mumbai, matches the searches below within a small radius.
  const matchingSearch = {
    originLat: 23.03,
    originLng: 72.58,
    destLat: 19.08,
    destLng: 72.88,
    earliestDeparture: "2027-01-01T00:00:00.000Z",
    latestDeparture: "2027-01-01T12:00:00.000Z",
    radiusKm: 20,
  };

  it("returns a ride whose origin, destination, and time window all match", async () => {
    const agent = await signupDriver();
    await agent.post("/api/rides").send(validRide);

    const res = await agent.get("/api/rides/search").query(matchingSearch);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ originLabel: "Ahmedabad", destLabel: "Mumbai" });
  });

  it("never includes driver contact fields in results", async () => {
    const agent = await signupDriver();
    await agent.post("/api/rides").send(validRide);

    const res = await agent.get("/api/rides/search").query(matchingSearch);

    expect(res.body[0].driver).toBeUndefined();
  });

  it("excludes a ride whose origin is outside the search radius", async () => {
    const agent = await signupDriver();
    await agent.post("/api/rides").send(validRide);

    const res = await agent.get("/api/rides/search").query({ ...matchingSearch, originLat: 28.7041, originLng: 77.1025 }); // Delhi

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it("excludes a ride whose departure time is outside the search window", async () => {
    const agent = await signupDriver();
    await agent.post("/api/rides").send(validRide);

    const res = await agent.get("/api/rides/search").query({
      ...matchingSearch,
      earliestDeparture: "2027-02-01T00:00:00.000Z",
      latestDeparture: "2027-02-01T12:00:00.000Z",
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(app).get("/api/rides/search").query(matchingSearch);
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/rides/:id/cancel", () => {
  it("cancels the driver's own scheduled ride", async () => {
    const agent = await signupDriver();
    const rideId = await createRide(agent);

    const res = await agent.patch(`/api/rides/${rideId}/cancel`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CANCELLED");
  });

  it("rejects cancelling a ride owned by another driver", async () => {
    const ownerAgent = await signupDriver("owner@example.com");
    const rideId = await createRide(ownerAgent);
    const otherAgent = await signupDriver("other@example.com");

    const res = await otherAgent.patch(`/api/rides/${rideId}/cancel`);

    expect(res.status).toBe(403);
  });

  it("rejects cancelling an already-cancelled ride", async () => {
    const agent = await signupDriver();
    const rideId = await createRide(agent);
    await agent.patch(`/api/rides/${rideId}/cancel`);

    const res = await agent.patch(`/api/rides/${rideId}/cancel`);

    expect(res.status).toBe(409);
  });

  it("returns 404 for a ride that does not exist", async () => {
    const agent = await signupDriver();

    const res = await agent.patch("/api/rides/00000000-0000-0000-0000-000000000000/cancel");

    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/rides/:id/complete", () => {
  it("completes the driver's own scheduled ride", async () => {
    const agent = await signupDriver();
    const rideId = await createRide(agent);

    const res = await agent.patch(`/api/rides/${rideId}/complete`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("COMPLETED");
  });

  it("rejects completing a ride owned by another driver", async () => {
    const ownerAgent = await signupDriver("owner2@example.com");
    const rideId = await createRide(ownerAgent);
    const otherAgent = await signupDriver("other2@example.com");

    const res = await otherAgent.patch(`/api/rides/${rideId}/complete`);

    expect(res.status).toBe(403);
  });

  it("rejects completing an already-completed ride", async () => {
    const agent = await signupDriver();
    const rideId = await createRide(agent);
    await agent.patch(`/api/rides/${rideId}/complete`);

    const res = await agent.patch(`/api/rides/${rideId}/complete`);

    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 14: Run the full suite — confirm everything is green**

Run: `npm test`
Expected: all tests PASS (`cors.test.ts`, `auth.middleware.test.ts`, `auth.test.ts`, `rides.test.ts`).

- [ ] **Step 15: Commit**

```bash
git add package.json package-lock.json src/lib/authCookie.ts src/middleware/auth.middleware.ts src/app.ts src/modules/auth/auth.controller.ts tests/unit/auth.middleware.test.ts tests/integration/auth.test.ts tests/integration/rides.test.ts
git commit -m "feat: switch auth from Bearer token to httpOnly cookie"
```

---

## Task 3: CSRF mitigation middleware

**Files:**
- Create: `src/middleware/csrf.ts`
- Create: `tests/unit/csrf.middleware.test.ts`
- Modify: `src/app.ts`
- Modify: `tests/integration/auth.test.ts`
- Modify: `tests/integration/rides.test.ts`

**Interfaces:**
- Produces (from `src/middleware/csrf.ts`): `requireCsrfHeader(req, res, next)`, `CSRF_HEADER_NAME: string` (value `"x-requested-with"`, lowercase — matches Express's lowercased `req.headers`), `CSRF_HEADER_VALUE: string` (value `"XMLHttpRequest"`). Both constants are consumed by this task's own test files and, later, Plan 2's frontend `api.ts` client (so the header name/value lives in exactly one place).

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/csrf.middleware.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/csrf.middleware.test.ts`
Expected: FAIL — `src/middleware/csrf.ts` doesn't exist yet (module not found).

- [ ] **Step 3: Create `src/middleware/csrf.ts`**

```ts
import type { NextFunction, Request, Response } from "express";
import { ForbiddenError } from "../lib/AppError";

export const CSRF_HEADER_NAME = "x-requested-with";
export const CSRF_HEADER_VALUE = "XMLHttpRequest";

const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

// SameSite=None (required because the frontend and API deploy as separate
// sites — design spec §3) gives the cookie no CSRF protection on its own.
// A plain cross-site HTML form can't set a custom header, so requiring one
// here blocks the classic CSRF vector without a full token scheme.
export function requireCsrfHeader(req: Request, _res: Response, next: NextFunction) {
  if (!MUTATING_METHODS.has(req.method)) {
    next();
    return;
  }
  if (req.headers[CSRF_HEADER_NAME] !== CSRF_HEADER_VALUE) {
    throw new ForbiddenError("Missing required CSRF header");
  }
  next();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/csrf.middleware.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Apply the middleware globally in `src/app.ts`**

Add the import:

```ts
import { requireCsrfHeader } from "./middleware/csrf";
```

Add `app.use(requireCsrfHeader);` right after `app.use(express.json());` and before the `pinoHttp` logger line:

```ts
app.use(express.json());
app.use(requireCsrfHeader);
app.use(
  pinoHttp({
```

- [ ] **Step 6: Run the full suite — confirm mutating requests in existing tests now fail**

Run: `npm test`
Expected: every `POST`/`PATCH` call in `tests/integration/auth.test.ts` and `tests/integration/rides.test.ts` now gets `403` instead of its expected status — this is the direct, expected consequence of this middleware now being globally enforced. Fixing it is the next step, in this same task.

- [ ] **Step 7: Add the CSRF header to every mutating call in `tests/integration/auth.test.ts`**

Replace the full content of `tests/integration/auth.test.ts`:

```ts
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app";
import { env } from "../../src/config/env";
import { prisma } from "../../src/lib/prisma";
import { CSRF_HEADER_NAME, CSRF_HEADER_VALUE } from "../../src/middleware/csrf";
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
    const res = await request(app)
      .post("/api/auth/signup")
      .set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE)
      .send(validSignup);

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
    const res = await request(app)
      .post("/api/auth/signup")
      .set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE)
      .send(validSignup);

    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it("rejects a second signup with the same email", async () => {
    await request(app).post("/api/auth/signup").set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE).send(validSignup);
    const res = await request(app)
      .post("/api/auth/signup")
      .set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE)
      .send(validSignup);

    expect(res.status).toBe(409);
  });

  it("rejects an invalid email before it reaches the database", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE)
      .send({ ...validSignup, email: "not-an-email" });

    expect(res.status).toBe(400);
    const usersCreated = await prisma.user.count();
    expect(usersCreated).toBe(0);
  });

  it("rejects a password shorter than 8 characters", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE)
      .send({ ...validSignup, password: "short" });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/login", () => {
  it("sets an auth cookie for correct credentials", async () => {
    await request(app).post("/api/auth/signup").set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE).send(validSignup);

    const res = await request(app)
      .post("/api/auth/login")
      .set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE)
      .send({ email: validSignup.email, password: validSignup.password });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeUndefined();
    expect(res.headers["set-cookie"]?.[0]).toMatch(/^token=/);
  });

  it("sets the cookie's Max-Age to match JWT_EXPIRES_IN", async () => {
    await request(app).post("/api/auth/signup").set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE).send(validSignup);

    const res = await request(app)
      .post("/api/auth/login")
      .set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE)
      .send({ email: validSignup.email, password: validSignup.password });

    const setCookie = res.headers["set-cookie"]?.[0] ?? "";
    const expectedSeconds = Math.floor(ms(env.JWT_EXPIRES_IN) / 1000);
    expect(setCookie).toMatch(new RegExp(`Max-Age=${expectedSeconds}`));
  });

  it("rejects a wrong password with 401", async () => {
    await request(app).post("/api/auth/signup").set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE).send(validSignup);

    const res = await request(app)
      .post("/api/auth/login")
      .set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE)
      .send({ email: validSignup.email, password: "wrong-password" });

    expect(res.status).toBe(401);
  });

  it("rejects an email that was never signed up with 401", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE)
      .send({ email: "nobody@example.com", password: "whatever123" });

    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 8: Add the CSRF header to every mutating call in `tests/integration/rides.test.ts`**

Note before editing: `requireCsrfHeader` runs globally, *before* `requireAuth` reaches the rides router (`app.use(requireCsrfHeader)` is registered ahead of `app.use("/api/rides", ridesRouter)` in `src/app.ts`). That means even the "rejects an unauthenticated request" tests below — which intentionally send no cookie — still need the CSRF header, otherwise they'd get `403` from the CSRF check and never reach the `401` from `requireAuth` that the test is actually asserting.

Replace the full content of `tests/integration/rides.test.ts`:

```ts
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app";
import { CSRF_HEADER_NAME, CSRF_HEADER_VALUE } from "../../src/middleware/csrf";
import { resetDb } from "./testDb";

beforeEach(resetDb);

type Agent = ReturnType<typeof request.agent>;

async function signupDriver(email = "dara@example.com"): Promise<Agent> {
  const agent = request.agent(app);
  await agent
    .post("/api/auth/signup")
    .set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE)
    .send({
      name: "Dara Driver",
      email,
      phone: "9999999999",
      password: "correct-horse",
    });
  return agent;
}

async function createRide(agent: Agent) {
  const res = await agent.post("/api/rides").set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE).send(validRide);
  return res.body.id as string;
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

describe("POST /api/rides", () => {
  it("creates a ride for an authenticated driver", async () => {
    const agent = await signupDriver();

    const res = await agent.post("/api/rides").set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE).send(validRide);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      originLabel: "Ahmedabad",
      destLabel: "Mumbai",
      totalSeats: 3,
      seatsAvailable: 3,
      status: "SCHEDULED",
    });
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(app).post("/api/rides").set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE).send(validRide);
    expect(res.status).toBe(401);
  });

  it("rejects a departureTime in the past", async () => {
    const agent = await signupDriver();

    const res = await agent
      .post("/api/rides")
      .set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE)
      .send({ ...validRide, departureTime: "2020-01-01T06:00:00.000Z" });

    expect(res.status).toBe(400);
  });

  it("rejects totalSeats <= 0", async () => {
    const agent = await signupDriver();

    const res = await agent
      .post("/api/rides")
      .set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE)
      .send({ ...validRide, totalSeats: 0 });

    expect(res.status).toBe(400);
  });
});

describe("GET /api/rides/search", () => {
  // Ahmedabad -> Mumbai, matches the searches below within a small radius.
  const matchingSearch = {
    originLat: 23.03,
    originLng: 72.58,
    destLat: 19.08,
    destLng: 72.88,
    earliestDeparture: "2027-01-01T00:00:00.000Z",
    latestDeparture: "2027-01-01T12:00:00.000Z",
    radiusKm: 20,
  };

  it("returns a ride whose origin, destination, and time window all match", async () => {
    const agent = await signupDriver();
    await agent.post("/api/rides").set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE).send(validRide);

    const res = await agent.get("/api/rides/search").query(matchingSearch);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ originLabel: "Ahmedabad", destLabel: "Mumbai" });
  });

  it("never includes driver contact fields in results", async () => {
    const agent = await signupDriver();
    await agent.post("/api/rides").set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE).send(validRide);

    const res = await agent.get("/api/rides/search").query(matchingSearch);

    expect(res.body[0].driver).toBeUndefined();
  });

  it("excludes a ride whose origin is outside the search radius", async () => {
    const agent = await signupDriver();
    await agent.post("/api/rides").set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE).send(validRide);

    const res = await agent.get("/api/rides/search").query({ ...matchingSearch, originLat: 28.7041, originLng: 77.1025 }); // Delhi

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it("excludes a ride whose departure time is outside the search window", async () => {
    const agent = await signupDriver();
    await agent.post("/api/rides").set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE).send(validRide);

    const res = await agent.get("/api/rides/search").query({
      ...matchingSearch,
      earliestDeparture: "2027-02-01T00:00:00.000Z",
      latestDeparture: "2027-02-01T12:00:00.000Z",
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(app).get("/api/rides/search").query(matchingSearch);
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/rides/:id/cancel", () => {
  it("cancels the driver's own scheduled ride", async () => {
    const agent = await signupDriver();
    const rideId = await createRide(agent);

    const res = await agent.patch(`/api/rides/${rideId}/cancel`).set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CANCELLED");
  });

  it("rejects cancelling a ride owned by another driver", async () => {
    const ownerAgent = await signupDriver("owner@example.com");
    const rideId = await createRide(ownerAgent);
    const otherAgent = await signupDriver("other@example.com");

    const res = await otherAgent.patch(`/api/rides/${rideId}/cancel`).set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE);

    expect(res.status).toBe(403);
  });

  it("rejects cancelling an already-cancelled ride", async () => {
    const agent = await signupDriver();
    const rideId = await createRide(agent);
    await agent.patch(`/api/rides/${rideId}/cancel`).set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE);

    const res = await agent.patch(`/api/rides/${rideId}/cancel`).set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE);

    expect(res.status).toBe(409);
  });

  it("returns 404 for a ride that does not exist", async () => {
    const agent = await signupDriver();

    const res = await agent
      .patch("/api/rides/00000000-0000-0000-0000-000000000000/cancel")
      .set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE);

    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/rides/:id/complete", () => {
  it("completes the driver's own scheduled ride", async () => {
    const agent = await signupDriver();
    const rideId = await createRide(agent);

    const res = await agent.patch(`/api/rides/${rideId}/complete`).set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("COMPLETED");
  });

  it("rejects completing a ride owned by another driver", async () => {
    const ownerAgent = await signupDriver("owner2@example.com");
    const rideId = await createRide(ownerAgent);
    const otherAgent = await signupDriver("other2@example.com");

    const res = await otherAgent.patch(`/api/rides/${rideId}/complete`).set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE);

    expect(res.status).toBe(403);
  });

  it("rejects completing an already-completed ride", async () => {
    const agent = await signupDriver();
    const rideId = await createRide(agent);
    await agent.patch(`/api/rides/${rideId}/complete`).set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE);

    const res = await agent.patch(`/api/rides/${rideId}/complete`).set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE);

    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 9: Run the full suite — confirm everything is green again**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 10: Commit**

```bash
git add src/middleware/csrf.ts tests/unit/csrf.middleware.test.ts src/app.ts tests/integration/auth.test.ts tests/integration/rides.test.ts
git commit -m "feat: add CSRF header requirement for mutating requests"
```

---

## Task 4: `GET /api/auth/me` and `POST /api/auth/logout`

**Files:**
- Modify: `src/modules/auth/auth.service.ts`
- Modify: `src/modules/auth/auth.controller.ts`
- Modify: `src/modules/auth/auth.routes.ts`
- Modify: `tests/integration/auth.test.ts`
- Modify: `CLAUDE.md`

**Interfaces:**
- Produces (from `src/modules/auth/auth.service.ts`): `getById(userId: string): Promise<PublicUser>` (reuses the file's existing private `toPublicUser` helper — no new exported type needed, the shape already matches what `signup`/`login` return as `user`).
- Consumes: `clearAuthCookie` from `src/lib/authCookie.ts` (Task 2), `requireAuth` from `src/middleware/auth.middleware.ts` (Task 2).

- [ ] **Step 1: Write the failing integration tests**

Add these two `describe` blocks to the end of `tests/integration/auth.test.ts` (after the existing `POST /api/auth/login` block):

```ts
describe("GET /api/auth/me", () => {
  it("returns the current user for a valid session", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/signup").set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE).send(validSignup);

    const res = await agent.get("/api/auth/me");

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: validSignup.email, name: validSignup.name });
  });

  it("returns 401 without a session", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/logout", () => {
  it("clears the session so a subsequent /me call is unauthenticated", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/signup").set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE).send(validSignup);

    const logoutRes = await agent.post("/api/auth/logout").set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE);
    expect(logoutRes.status).toBe(200);

    const meRes = await agent.get("/api/auth/me");
    expect(meRes.status).toBe(401);
  });

  it("succeeds even with no existing session", async () => {
    const res = await request(app).post("/api/auth/logout").set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE);
    expect(res.status).toBe(200);
  });
});
```

(`CSRF_HEADER_NAME`/`CSRF_HEADER_VALUE` are already imported from Task 3; `request`, `app`, `validSignup` are already in scope from the top of the file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/auth.test.ts`
Expected: FAIL — `GET /api/auth/me` and `POST /api/auth/logout` don't exist yet, so Express's catch-all 404 handler responds with `404` instead of `200`/`401`.

- [ ] **Step 3: Add `getById` to `auth.service.ts`**

Add this function to `src/modules/auth/auth.service.ts`, after the existing `login` function:

```ts
export async function getById(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new UnauthenticatedError("User no longer exists");
  }
  return toPublicUser(user);
}
```

- [ ] **Step 4: Add handlers to `auth.controller.ts`**

Add the import and two handlers to `src/modules/auth/auth.controller.ts`:

```ts
import { clearAuthCookie, setAuthCookie } from "../../lib/authCookie";
```

(replaces the existing `import { setAuthCookie } from "../../lib/authCookie";` line — both are now needed)

```ts
export async function meHandler(req: Request, res: Response) {
  const user = await authService.getById(req.user!.sub);
  res.status(200).json({ user });
}

export function logoutHandler(_req: Request, res: Response) {
  clearAuthCookie(res);
  res.status(200).json({ message: "Logged out" });
}
```

(add both after the existing `loginHandler` function)

- [ ] **Step 5: Wire the routes in `auth.routes.ts`**

Replace the full content of `src/modules/auth/auth.routes.ts`:

```ts
import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler";
import { requireAuth } from "../../middleware/auth.middleware";
import { validateBody } from "../../middleware/validate";
import { loginHandler, logoutHandler, meHandler, signupHandler } from "./auth.controller";
import { loginSchema, signupSchema } from "./auth.schemas";

export const authRouter = Router();

authRouter.post("/signup", validateBody(signupSchema), asyncHandler(signupHandler));
authRouter.post("/login", validateBody(loginSchema), asyncHandler(loginHandler));
authRouter.post("/logout", logoutHandler);
authRouter.get("/me", requireAuth, asyncHandler(meHandler));
```

(`logoutHandler` isn't wrapped in `asyncHandler` — it has no `await` inside, so there's no promise rejection for `asyncHandler` to catch. `requireAuth` on `/me` is a synchronous throw, also not wrapped, matching the existing pattern already used for `requireRole` elsewhere in the codebase.)

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/integration/auth.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 8: Update `CLAUDE.md`**

In the "Three distinct authorization layers" section, replace this line:

```
1. **Authentication** (`requireAuth` in `src/middleware/auth.middleware.ts`) — verifies the JWT, populates `req.user` (`{ sub, roles }`).
```

with:

```
1. **Authentication** (`requireAuth` in `src/middleware/auth.middleware.ts`) — verifies the JWT read from the `token` httpOnly cookie (not an `Authorization` header — see "Cookie-based auth" below), populates `req.user` (`{ sub, roles }`).
```

Then add a new subsection right after the "### Error handling" section and before "### Money and matching":

```markdown
### Cookie-based auth, and why GET never needs a CSRF header

The JWT lives only in an `httpOnly` cookie (`src/lib/authCookie.ts`'s
`AUTH_COOKIE_NAME`), never in a response body — `GET /api/auth/me` is the
only way to learn the current user, since JavaScript can't read the cookie
itself. `secure`/`sameSite` differ by environment: production needs
`sameSite: "none"` because the frontend and API deploy as separate Render
services (different sites, not just different origins); local dev uses
`sameSite: "lax"` since `localhost:5173` and `localhost:3000` differ only by
port, which *is* same-site.

`SameSite=None` alone gives no CSRF protection, so `requireCsrfHeader`
(`src/middleware/csrf.ts`), applied globally, rejects any `POST`/`PATCH`/
`PUT`/`DELETE` missing an `X-Requested-With: XMLHttpRequest` header — a
plain cross-site HTML form can't set custom headers, so this blocks the
classic CSRF vector. It never checks `GET`, since `GET` isn't mutating;
full reasoning for this tradeoff vs. a token-based CSRF scheme is in
[2026-10-08-frontend-cookie-auth-design.md](docs/superpowers/specs/2026-10-08-frontend-cookie-auth-design.md)
§3.

Integration tests use Supertest's `request.agent(app)` (not plain
`request(app)`) wherever a cookie needs to persist across multiple
requests — plain `request(app)` doesn't retain cookies between calls.
```

- [ ] **Step 9: Commit**

```bash
git add src/modules/auth/auth.service.ts src/modules/auth/auth.controller.ts src/modules/auth/auth.routes.ts tests/integration/auth.test.ts CLAUDE.md
git commit -m "feat: add GET /api/auth/me and POST /api/auth/logout"
```
