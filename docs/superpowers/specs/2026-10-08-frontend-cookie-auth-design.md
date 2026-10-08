# Frontend + Cookie-Based Auth — Design Spec

**Status:** Approved for implementation
**Builds on:** [2026-09-26-ride-sharing-matching-design.md](2026-09-26-ride-sharing-matching-design.md)

## 1. Problem

The backend (auth + partial rides module) has no UI. This spec adds a real,
usable React frontend covering everything the backend currently supports —
signup/login, post a ride, search rides, and manage your own posted rides.
No booking UI yet; the Bookings API itself doesn't exist (tracked separately
in the base spec's §9).

Adding a browser frontend forces a second decision: how the browser
authenticates. The existing API issues a JWT returned in the response body,
read by whatever client holds it (tests, curl, Postman). A browser frontend
storing that token in `localStorage` works, but is readable by any
successfully-injected script (XSS). This spec switches to an `httpOnly`
cookie instead, which JavaScript cannot read at all — closing that specific
attack surface. That choice has a knock-on consequence covered in §3.

## 2. Scope

**In scope:**
- Backend: cookie-based auth (`httpOnly`, `Secure` in production), a new
  `GET /api/auth/me` and `POST /api/auth/logout`, CSRF mitigation, CORS
  locked to the frontend's origin.
- Frontend: React + Vite + TypeScript SPA in a new `web/` directory —
  signup, login, search rides, post a ride, view/cancel/complete own rides.
- Deployment: frontend as a second Render service (Static Site), alongside
  the existing API service, both defined in the one `render.yaml`.

**Out of scope (unchanged from base spec, plus):**
- Booking UI (no backend to call yet).
- A full CSRF token scheme (double-submit cookie) — the lighter
  custom-header mitigation in §3 is the chosen approach; upgrading to a full
  token scheme is a documented, additive future option, not built now.
- Mobile app / non-browser client support for the new cookie-only auth —
  if that's ever needed, it would mean adding back a body-returned token
  for non-browser clients specifically, not changing the browser flow.

## 3. Why cookies need `SameSite=None`, and the CSRF tradeoff that creates

The frontend and backend deploy as two separate Render services, each on
its own `*.onrender.com` subdomain. Different subdomains under a
public-suffix domain count as different **sites** for cookie purposes, not
just different origins. `SameSite=Lax` — the normal safe default — is
**not sent at all** on cross-site `fetch()` calls (only on top-level
navigations), so it would silently break auth between the two services.
Making the cookie work here requires `SameSite=None; Secure`.

`SameSite=None` provides no CSRF protection by itself: the browser attaches
the cookie to a request regardless of which site triggered it. Mitigation
chosen: a small `requireCsrfHeader` middleware rejects any `POST`/`PATCH`/
`PUT`/`DELETE` request missing a custom header
(`X-Requested-With: XMLHttpRequest`). A plain cross-site HTML form —
the classic CSRF vector — cannot set custom headers, so this blocks it
with one small middleware instead of a full token scheme. Combined with
CORS locked to the frontend's exact origin (so a malicious page's
`fetch()` calls can't even read a response, let alone set the header
convincingly from a real browser context), this is judged sufficient for
this POC's threat model. A full double-submit-cookie CSRF token remains a
documented upgrade path if this ever needs to be more robust.

## 4. Backend changes

### 4.1 Cookie issuance

`auth.controller.ts`'s `signupHandler`/`loginHandler` stop returning `token`
in the JSON body. Instead:

```ts
res.cookie("token", token, {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: env.NODE_ENV === "production" ? "none" : "lax",
  path: "/",
  maxAge: ms(env.JWT_EXPIRES_IN),
});
res.status(201).json({ user });
```

`secure`/`sameSite` are environment-dependent on purpose: `Secure` cookies
are never sent over plain HTTP, and local dev runs both the Vite dev server
and Express over `http://localhost`. `localhost:5173` and `localhost:3000`
differ only by port, which **is** same-site (site = scheme + registrable
domain, port-independent) — so `SameSite=Lax` works fine for local dev
without needing `Secure` at all. Production genuinely needs the
cross-site-safe combination.

`ms` (already a transitive dependency of `jsonwebtoken`) is added as a
direct dependency so `JWT_EXPIRES_IN` and the cookie's `maxAge` can never
drift out of sync with each other — one source of truth for the session
length, read twice.

### 4.2 New endpoints

- **`GET /api/auth/me`** (authenticated) — returns `{ user }` for whoever
  the cookie identifies. This is the only way the frontend can know "am I
  logged in" and "what are my roles," since the JWT itself is no longer
  readable by JavaScript.
- **`POST /api/auth/logout`** (no auth required — must work even against an
  already-expired cookie) — `res.clearCookie("token", { ...same attributes
  as issuance... })`.

### 4.3 Middleware changes

- `requireAuth` (`auth.middleware.ts`) reads `req.cookies.token` instead of
  the `Authorization` header. `cookie-parser` is added to `app.ts`.
- New `requireCsrfHeader` middleware (`src/middleware/csrf.ts`), applied
  globally in `app.ts` before the routers: throws `ForbiddenError` (reusing
  the existing `AppError` subclass — this is semantically "not allowed
  without the right header," not a new failure category) when a mutating
  request lacks `X-Requested-With: XMLHttpRequest`.
- `app.ts`'s CORS changes from the current wildcard `cors()` to
  `cors({ origin: env.FRONTEND_ORIGIN, credentials: true })`.

### 4.4 Config

New required env var `FRONTEND_ORIGIN`, defaulting to
`http://localhost:5173` (Vite's default dev port) in `env.ts`'s schema so
local dev/tests work unconfigured; production (`render.yaml`) sets it
explicitly to the deployed frontend's Render URL.

### 4.5 Test suite impact

`tests/integration/auth.test.ts` and `tests/integration/rides.test.ts`
currently extract `res.body.token` after signup and manually attach it as
`Authorization: Bearer <token>` on every subsequent request. With
cookie-based auth, this no longer works — there's no token in the body to
extract. Both files' helpers (`signupDriver()`, `createRide()`, etc.) switch
to Supertest's `request.agent(app)`, which persists cookies across requests
on the same agent automatically, replacing the manual header-setting
entirely. `auth.test.ts` gains assertions on `GET /me` and
`POST /logout`; a new test confirms `requireCsrfHeader` rejects a mutating
request missing the header.

## 5. Frontend architecture (`web/`)

A self-contained Vite project — its own `package.json`, independent of the
root one (no workspace tooling needed for two packages).

**Stack:** React + Vite + TypeScript, Tailwind CSS, React Router, TanStack
Query.

**Pages:**

| Route | Purpose |
|---|---|
| `/signup`, `/login` | Auth forms |
| `/rides` | Search rides (the bounding-box + time-window query) |
| `/rides/new` | Post a ride (driver only) |
| `/rides/mine` | Own posted rides — cancel/complete actions |

**`web/src/lib/api.ts`** — a `fetch` wrapper: `credentials: "include"` on
every call (so the cookie is sent/received), the CSRF header auto-attached
on mutating methods, base URL from `import.meta.env.VITE_API_URL` (a
build-time env var — Vite bakes it into the static bundle, unlike the
backend's runtime env vars).

**Auth state:** a route-guard component calls `GET /api/auth/me` via
TanStack Query on mount. `401` → redirect to `/login`. `200` → the
returned `{ user }` becomes the cached source of truth for "logged in" and
"roles," gating UI elements like the "Post a ride" nav link for drivers.
This is UX convenience only — the backend's RBAC middleware remains the
actual enforcement; hiding a link doesn't substitute for the `403` a
non-driver would still get from the API directly.

## 6. Data flow

- **Login:** submit → `POST /api/auth/login` (sets cookie) → frontend
  refetches `/api/auth/me` → redirect to `/rides`.
- **Post ride:** submit → `POST /api/rides` (cookie + CSRF header) → `201`
  → navigate to `/rides/mine`.
- **Search:** `GET /api/rides/search?...` (no CSRF header needed — `GET`
  isn't mutating) → render results.
- **Logout:** click → `POST /api/auth/logout` → frontend clears its cached
  `/api/auth/me` result → redirect to `/login`.

## 7. Error handling

The backend's existing error shape (`{ error, message }` or
`{ error, details }` for Zod validation errors) is unchanged. The frontend's
`api.ts` wrapper throws a typed `ApiError` (status + message) on any
non-2xx response; TanStack Query's error state surfaces it to the calling
component, rendered as an inline form error (signup/login/post-ride forms)
or an inline message (search/list views). A `401` specifically from
`/api/auth/me` is treated as "not logged in," not a surfaced error — the
route guard redirects silently rather than showing an error state.

## 8. Testing

Both backend and frontend changes follow the project's existing TDD
discipline (failing test first, then minimal implementation, then
refactor) — no exception for the frontend. Frontend tests use React
Testing Library + Vitest (already a dependency at the root; `web/` gets
its own Vitest config, consistent with keeping the two packages
independent).

## 9. Deployment

`render.yaml` gains a second service — a Static Site — alongside the
existing web service:

```yaml
  - type: web
    name: ride-sharing-poc-web
    runtime: static
    rootDir: web
    buildCommand: npm install && npm run build
    staticPublishPath: dist
    envVars:
      - key: VITE_API_URL
        sync: false # the deployed API service's URL
```

Both services' names are known before either is deployed (Render URLs are
`<service-name>.onrender.com`), so there's no real ordering problem:
create both services, then set `FRONTEND_ORIGIN` on the API service and
`VITE_API_URL` on the static site to each other's predictable URLs, then
deploy both.

## 10. Delivery order

1. Backend: cookie auth, `GET /me`, `POST /logout`, CSRF middleware, CORS
   change — TDD, including the test-helper rewrite to `request.agent(app)`.
2. Frontend scaffold: Vite + React + TS + Tailwind + Router + TanStack
   Query setup, the `api.ts` client, the auth route guard.
3. Frontend pages, in order: signup/login → search rides → post a ride →
   my rides (cancel/complete).
4. Deployment: extend `render.yaml`, wire `FRONTEND_ORIGIN` /
   `VITE_API_URL`, deploy both services.
