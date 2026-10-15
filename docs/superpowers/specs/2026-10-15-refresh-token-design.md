# Refresh tokens — design

Date: 2026-10-15
Status: draft, awaiting review

## 1. Problem

Auth today is one JWT in an httpOnly `token` cookie, lifetime `JWT_EXPIRES_IN`
(default `1d`), with no renewal: when it expires the next request is a 401 and the
user must type their password again. The flip side is that a stolen cookie is
good for a full day and logout cannot invalidate it server-side.

## 2. Goals and non-goals

Goals
- Users stay signed in without re-entering a password every day.
- A stolen access cookie is useful for ~15 minutes, not a day.
- Logout ends the session server-side (the refresh token is revoked).
- A stolen refresh token is detected when the legitimate user or the thief
  reuses it (rotation with reuse detection).

Non-goals
- Session/device management UI, "log out everywhere" endpoint.
- Redis-backed sessions; revoking an already-issued access JWT before it expires.
- Changing the CSRF scheme, CORS, or the JWT payload (`{ sub, roles }`).

## 3. Design

### 3.1 Cookies (`src/lib/authCookie.ts`)

| Cookie | Content | Lifetime | Path |
| --- | --- | --- | --- |
| `token` (unchanged name) | access JWT | `JWT_EXPIRES_IN`, default `15m` | `/` |
| `refresh_token` (new) | 32 random bytes, base64url | `REFRESH_TOKEN_EXPIRES_IN`, default `7d` | `/api/auth` |

`httpOnly`, `secure` (production only) and `sameSite` (`none` in production, `lax`
in dev) follow the existing `cookieOptions()`. The refresh cookie's path is
`/api/auth`, not `/api/auth/refresh`, because `POST /api/auth/logout` must receive
it to revoke the row; the cookie is still never sent to rides, bookings, vehicles
or admin routes. `clearRefreshCookie` must use the same path or the browser will
not delete it. New helpers: `setRefreshCookie`, `clearRefreshCookie`;
`setAuthCookie`/`clearAuthCookie` stay.

### 3.2 Data model (`prisma/schema.prisma`)

```prisma
model RefreshToken {
  id        String    @id @default(uuid())
  userId    String
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash String    @unique   // SHA-256 hex of the raw cookie value
  expiresAt DateTime
  revokedAt DateTime?
  createdAt DateTime  @default(now())

  @@index([userId])
}
```

`User` gains `refreshTokens RefreshToken[]`. Only the hash is stored, so a DB leak
does not yield usable tokens. The raw value is opaque (not a JWT): validity is
decided by the row, which is what makes it revocable. One additive migration.

### 3.3 Token service (`src/modules/auth/refreshToken.service.ts`)

- `issue(userId)` — generate raw value, insert row, return raw.
- `rotate(raw)` — see 3.4; returns `{ user, accessToken, refreshToken? }`.
- `revokeByRaw(raw)` — set `revokedAt` on the matching row if still active.

`signup` and `login` call `issue`; their controllers set both cookies. `login`
also deletes that user's rows with `expiresAt < now()` (no separate cleanup job).

### 3.4 `POST /api/auth/refresh`

Middleware: global `requireCsrfHeader` (already applies), new `refreshLimiter`
(per IP, `createLimiter`, name `refresh`). No `requireAuth` — the access cookie is
typically expired when this is called.

`rotate(raw)`:
1. Hash `raw`; no cookie → 401.
2. Conditional update, one winner under Postgres's row lock (same pattern as the
   booking race handling):
   `UPDATE … SET revokedAt = now() WHERE tokenHash = ? AND revokedAt IS NULL AND expiresAt > now()`.
3. Count 1 (winner): load the user (missing → 401), sign a new access token with
   the user's *current* roles, `issue` a new refresh token. Respond 200
   `{ user }` and set both cookies.
4. Count 0: look the row up.
   - Not found or `expiresAt` passed → 401.
   - Revoked within `REFRESH_REUSE_GRACE_SECONDS` (default 10) → concurrent
     refresh from another tab. Respond 200, set only a fresh access cookie; leave
     the refresh cookie alone (the winning tab's is already in the shared jar).
   - Revoked longer ago → reuse. Revoke all of that user's active refresh tokens,
     log a warning with the user id, clear both cookies, 401. The user must log in.

Role/ban changes therefore take effect within one access lifetime.

### 3.5 Logout

`POST /api/auth/logout` stays unauthenticated (an expired access cookie must still
be able to log out). It reads `refresh_token`, calls `revokeByRaw` if present, and
clears both cookies.

### 3.6 Config

- `JWT_EXPIRES_IN`: default `1d` → `15m` in `src/config/env.ts`, `.env.example`,
  `docker-compose.yml`, `render.yaml`.
- New `REFRESH_TOKEN_EXPIRES_IN` (default `7d`), `REFRESH_REUSE_GRACE_SECONDS`
  (default `10`) in `env.ts`, `.env.example`, `docker-compose.yml`, `render.yaml`.

### 3.7 Frontend (`web/src/lib/api.ts`)

`apiFetch`, on a 401 from any path other than login, signup and refresh: makes one
shared in-flight `POST /api/auth/refresh` (a module-level promise, so concurrent
401s trigger a single refresh), then retries the original request once. If the
refresh fails, it throws the *original* 401 `ApiError`, so existing "not logged
in" handling (e.g. `/me` → login redirect) is unchanged. There is no redirect
logic in `apiFetch` and no retry loop (the retry is not itself retried). This also
covers page load: `/me` 401 → refresh → retry.

### 3.8 Docs

Swagger JSDoc on the new route (and updated notes on login/logout); the CLAUDE.md
"Cookie-based auth" section, including the testing decision below.

## 4. Testing (explicit decision)

No new automated tests, backend or frontend, same as Bookings, rate limiting and
notifications (CLAUDE.md records this). Verification instead: the existing backend
suite (`npm test`), the web suite (`cd web && npm test`), `tsc --noEmit`, and a
manual walk-through against the dev server (login, expiry, refresh, reuse, logout).
`resetDb()` needs no change: `RefreshToken` cascades from `User`.

## 5. Accepted risks

- The grace window lets a refresh token that is < 10 s old mint one access token
  after rotation.
- An issued access JWT cannot be revoked before its 15 minutes are up.
- The refresh endpoint is rate-limited per IP; behind a shared NAT, users share
  that bucket (the same trade-off as login).
