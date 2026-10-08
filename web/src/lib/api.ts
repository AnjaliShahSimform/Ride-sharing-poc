// The CSRF header name/value must match the backend's src/middleware/csrf.ts
// exactly. Duplicated here on purpose — this package shares no imports with
// the root src/ (separate deployable, no monorepo tooling).
const CSRF_HEADER_NAME = "x-requested-with";
const CSRF_HEADER_VALUE = "XMLHttpRequest";
const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

const API_BASE_URL = import.meta.env.VITE_API_URL ?? "";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
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

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (MUTATING_METHODS.has(method)) {
    headers[CSRF_HEADER_NAME] = CSRF_HEADER_VALUE;
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    credentials: "include",
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const message = data?.message ?? messageFromDetails(data?.details) ?? data?.error ?? "Request failed";
    throw new ApiError(res.status, message);
  }

  return data as T;
}
