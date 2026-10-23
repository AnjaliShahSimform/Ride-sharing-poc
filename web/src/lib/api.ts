// The CSRF header name/value must match the backend's src/middleware/csrf.ts
// exactly. Duplicated here on purpose — this package shares no imports with
// the root src/ (separate deployable, no monorepo tooling).
import { queryClient } from "./queryClient";

const CSRF_HEADER_NAME = "x-requested-with";
const CSRF_HEADER_VALUE = "XMLHttpRequest";
const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

const API_BASE_URL = import.meta.env.VITE_API_URL ?? "";

export class ApiError extends Error {
  status: number;
  // The backend's error class name (e.g. "PhoneNotVerifiedError").
  code?: string;
  // From a 429's Retry-After header.
  retryAfterSeconds?: number;

  constructor(status: number, message: string, code?: string, retryAfterSeconds?: number) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
}

// The backend's error handler (src/middleware/errorHandler.ts) sends a Zod
// validation failure as { error: "ValidationError", details } with no
// `message` field, where `details` is `err.flatten().fieldErrors` — a
// Record<string, string[]> of per-field messages. Without this, apiFetch's
// message ?? error fallback surfaces the literal string "ValidationError"
// to the user instead of anything actionable.
function messageFromDetails(details: unknown): string | undefined {
  if (!details || typeof details !== "object") {
    return undefined;
  }
  const messages = Object.values(details as Record<string, unknown>)
    .flat()
    .filter((value): value is string => typeof value === "string");
  return messages.length > 0 ? messages.join(" ") : undefined;
}

// Paths where a 401 means "wrong credentials / no session", not "access cookie
// expired" — retrying them through a refresh would be pointless (or a loop).
const NO_REFRESH_PATHS = new Set(["/api/auth/login", "/api/auth/signup", "/api/auth/refresh"]);

async function send(path: string, options: RequestOptions) {
  const method = options.method ?? "GET";
  // A FormData body must NOT get a JSON Content-Type: the browser has to set
  // multipart/form-data itself, boundary included.
  const isForm = typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers: Record<string, string> = isForm ? {} : { "Content-Type": "application/json" };
  if (MUTATING_METHODS.has(method)) {
    headers[CSRF_HEADER_NAME] = CSRF_HEADER_VALUE;
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    credentials: "include",
    body: options.body ? (isForm ? (options.body as FormData) : JSON.stringify(options.body)) : undefined,
  });

  const data = await res.json().catch(() => null);
  return { res, data };
}

// Concurrent 401s (a page firing several queries at once) share one refresh
// call. Besides saving requests this matters for correctness: refresh tokens are
// single-use, so parallel refreshes would race each other on the server.
let refreshInFlight: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  refreshInFlight ??= send("/api/auth/refresh", { method: "POST" })
    .then(({ res }) => res.ok)
    .catch(() => false)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let { res, data } = await send(path, options);

  // The 15-minute access cookie expired: renew it from the refresh cookie and
  // replay the request once. If renewal fails the original 401 surfaces below,
  // so callers' existing "not logged in" handling is unchanged.
  if (res.status === 401 && !NO_REFRESH_PATHS.has(path) && (await refreshSession())) {
    ({ res, data } = await send(path, options));
  }

  if (!res.ok) {
    const message = data?.message ?? messageFromDetails(data?.details) ?? data?.error ?? "Request failed";
    // A stale tab (or a session that just became gated): re-read the current
    // user so RequireAuth sees phoneVerified:false and sends them to /verify-phone.
    if (data?.error === "PhoneNotVerifiedError") {
      void queryClient.invalidateQueries({ queryKey: ["currentUser"] });
    }
    const retryAfter = Number(res.headers?.get("Retry-After"));
    throw new ApiError(res.status, message, data?.error, retryAfter > 0 ? retryAfter : undefined);
  }

  return data as T;
}
