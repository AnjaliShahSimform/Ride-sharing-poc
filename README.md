# Ride Sharing POC

A scheduled ride-sharing / carpool-matching API (BlaBlaCar-style — no live GPS, no dispatch, no surge pricing). Drivers post a scheduled ride; riders search for a matching route and time window, and book a seat.

The full design rationale — data model, the indexed matching query, and the race-safe last-seat booking guarantee — is documented in [docs/superpowers/specs/2026-09-26-ride-sharing-matching-design.md](docs/superpowers/specs/2026-09-26-ride-sharing-matching-design.md).

**Stack:** Express + TypeScript + PostgreSQL + Prisma.

## Status

- ✅ Auth (signup/login, cookie-based sessions, RBAC)
- 🟡 Rides — create, search, cancel, complete, mine are built; `GET /:id` is not yet
- ✅ Frontend (`web/`) — signup/login, search rides, post a ride, manage your own rides
- ✅ Bookings — race-safe seat booking, cancellation, cost splitting, contact visibility on confirmed match
- ✅ Audit log wiring
- ✅ Admin — read-only view over all users, all rides, and the audit log (no self-service signup; account is seeded or created directly in the database)

## Running locally

```bash
cp .env.example .env          # defaults already point at localhost:5433
docker compose up -d db       # starts Postgres only
npm install
npm run prisma:migrate        # applies migrations
npm run dev                   # http://localhost:3000
```

Health check: `GET /health`. Interactive API docs (Swagger UI, generated from the route code): `GET /api-docs`.

### Tests

```bash
npm test                      # full suite — hits a real Postgres, no mocks
npx vitest run <path>          # a single test file
```

### Full stack via Docker Compose

```bash
docker compose up             # app + db, migrations run automatically on container start
```

## API surface (implemented so far)

| Method & path | Access | Notes |
|---|---|---|
| `POST /api/auth/signup` | public | roles `[DRIVER, RIDER]`, sets an `httpOnly` auth cookie, returns `{ user }` |
| `POST /api/auth/login` | public | sets an `httpOnly` auth cookie, returns `{ user }` |
| `GET /api/auth/me` | authenticated | returns `{ user }` for the current session |
| `POST /api/auth/logout` | public | clears the auth cookie; `200` even with no existing session |
| `POST /api/rides` | `DRIVER` | rejects past `departureTime`, `totalSeats <= 0` |
| `GET /api/rides/search` | authenticated | indexed bounding-box + time-window match |
| `GET /api/rides/mine` | `DRIVER` | own posted rides, any status, newest first |
| `PATCH /api/rides/:id` | `DRIVER` + ownership | edits route/time/seats/cost; `409` if not `SCHEDULED` or if any `CONFIRMED` booking exists |
| `PATCH /api/rides/:id/cancel` | `DRIVER` + ownership | |
| `PATCH /api/rides/:id/complete` | `DRIVER` + ownership | locks the ride |
| `POST /api/rides/:id/bookings` | `RIDER` | race-safe seat reservation; `409` if no seats left or ride isn't scheduled |
| `GET /api/bookings/mine` | `RIDER` | own bookings, any status; driver contact included only when `CONFIRMED` |
| `PATCH /api/bookings/:id/cancel` | rider (own) or driver (ride's owner) | returns the seat to availability, recalculates remaining riders' cost shares |
| `GET /api/rides/:id/bookings` | `DRIVER` + ownership | riders on this ride; rider contact included only when `CONFIRMED` |
| `GET /api/admin/users` | `ADMIN` | every user, never includes `passwordHash` |
| `GET /api/admin/rides` | `ADMIN` | every ride from every driver, any status |
| `GET /api/admin/audit-logs` | `ADMIN` | paginated (`?page=&pageSize=`), newest first |

Auth is cookie-based, not Bearer-token: signup/login set an `httpOnly` `token`
cookie (sent automatically by the browser on subsequent requests), rather than
returning a JWT in the response body. Every route but signup/login/logout
requires that cookie. Mutating requests (`POST`/`PATCH`/`PUT`/`DELETE`) also
require an `X-Requested-With: XMLHttpRequest` header (CSRF mitigation) —
`GET` requests never need it.

## Deploying (free tier)

This app deploys as-is to any Docker-friendly host. The setup below uses **Render** (app hosting) + **Neon** (Postgres) — both free, and Neon's free tier doesn't expire (Render's own free Postgres is deleted after 90 days).

### 1. Database — Neon

1. Create a free project at [neon.tech](https://neon.tech) (Postgres only — skip Object storage, Functions, AI gateway, and Neon Auth; this app doesn't use any of them, and Neon Auth in particular is a separate hosted identity system, not something this app's own JWT-based auth would plug into).
2. Neon gives you **two** connection strings — grab both:
   - The **pooled** one (hostname contains `-pooler`) → this is `DATABASE_URL`.
   - The **direct** one (no `-pooler`) → this is `DIRECT_URL`.
   Prisma's migration engine needs the direct connection — its advisory locks don't work reliably through a transaction-mode pooler, which is why the schema and Render config split these into two variables.

### 2. App — Render

This repo includes `render.yaml`, so Render can provision the service from a Blueprint:

1. Push this repo to GitHub (already done if you're reading this from the deployed repo).
2. In the Render dashboard: **New → Blueprint**, point it at this repo. Render reads `render.yaml` and proposes the `ride-sharing-poc` web service.
3. Before the first deploy, set both `DATABASE_URL` (pooled) and `DIRECT_URL` (direct) on the service to the two Neon connection strings above — both are marked `sync: false` in `render.yaml`, so Render prompts for them rather than guessing a value. `JWT_SECRET` is auto-generated by Render; no action needed there.
4. Deploy. Render builds the existing `Dockerfile`, then runs `npx prisma migrate deploy` before starting the server, so the schema is applied automatically on first boot (and again, harmlessly, on every subsequent cold start).

**Free-tier tradeoff to expect:** Render's free web services spin down after 15 minutes of inactivity and cold-start (a few seconds' delay) on the next request. Fine for a demo/POC; not for anything latency-sensitive.

### 3. Frontend — Render Static Site

Also defined in `render.yaml` (`ride-sharing-poc-web`), deployed from the same Blueprint:

1. Set `VITE_API_URL` on the static site service to the API service's deployed URL (e.g. `https://ride-sharing-poc.onrender.com`).
2. Set `FRONTEND_ORIGIN` on the **API** service to the static site's deployed URL (e.g. `https://ride-sharing-poc-web.onrender.com`) — the backend's CORS config rejects any other origin.
3. Deploy. Render builds `web/` with `npm install && npm run build` and serves `web/dist` from a CDN — no cold-start/spin-down, unlike the free web service.

**Local development:** `cd web && npm install && npm run dev` (Vite's dev server runs on `http://localhost:5173` by default, which matches the backend's `FRONTEND_ORIGIN` default — no extra config needed).
