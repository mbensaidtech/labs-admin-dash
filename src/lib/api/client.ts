"use client";

/** Browser-side fetch of the admin API: throws on any non-2xx response, redirects to login on 401. */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
    headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...(init?.headers ?? {}) },
  });

  if (response.status === 401 && !path.startsWith("/api/admin/login")) {
    const next = `${window.location.pathname}${window.location.search}`;
    const login = new URL("/login", window.location.origin);
    login.searchParams.set("next", next);
    // Full navigation on purpose: the session is gone, the client-side cache must not survive.
    window.location.assign(login.toString());
    throw new ApiClientError(401, "unauthorized", "Session expired");
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string; details?: Record<string, unknown> };
  if (!response.ok) {
    throw new ApiClientError(response.status, body.error ?? "internal", body.message ?? response.statusText, body.details);
  }
  return body as T;
}

export function postJson<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
}
