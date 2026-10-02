import { ApiError } from "@/lib/api/errors";

/**
 * Fixed-window counters kept in memory. On serverless hosting each instance has its own counters,
 * which is acceptable for a cohort-sized workshop (the limits are a safety net, not accounting).
 */
interface Window {
  start: number;
  count: number;
}

const windows = new Map<string, Window>();
const WINDOW_MS = 60_000;
let lastSweep = 0;

export const RATE_LIMITS = {
  eventsPerToken: 120,
  registrationsPerIp: 30,
} as const;

export function checkRateLimit(key: string, limit: number, now = Date.now()): void {
  sweep(now);
  const window = windows.get(key);
  if (!window || now - window.start >= WINDOW_MS) {
    windows.set(key, { start: now, count: 1 });
    return;
  }
  window.count += 1;
  if (window.count > limit) {
    const retryAfter = Math.max(1, Math.ceil((window.start + WINDOW_MS - now) / 1000));
    throw new ApiError(
      "rateLimited",
      `Rate limit of ${limit} requests per minute exceeded`,
      { retryAfterSeconds: retryAfter },
      { "Retry-After": String(retryAfter) },
    );
  }
}

export function resetRateLimits(): void {
  windows.clear();
}

function sweep(now: number): void {
  if (now - lastSweep < WINDOW_MS) return;
  lastSweep = now;
  for (const [key, window] of windows) {
    if (now - window.start >= WINDOW_MS) windows.delete(key);
  }
}

/** Client address for per-IP limits: never stored, only used as a counter key. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
