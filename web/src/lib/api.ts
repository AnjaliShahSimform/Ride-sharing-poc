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
    const message = data?.message ?? data?.error ?? "Request failed";
    throw new ApiError(res.status, message);
  }

  return data as T;
}
