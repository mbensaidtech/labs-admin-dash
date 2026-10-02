/** Five failed logins per IP per 15 minutes → 429 (Business Rule 13). In-memory, per instance. */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

interface Failures {
  first: number;
  count: number;
}

const failures = new Map<string, Failures>();

export function loginBlockedFor(ip: string, now = Date.now()): number {
  const entry = failures.get(ip);
  if (!entry) return 0;
  if (now - entry.first >= WINDOW_MS) {
    failures.delete(ip);
    return 0;
  }
  return entry.count >= MAX_FAILURES ? Math.ceil((entry.first + WINDOW_MS - now) / 1000) : 0;
}

export function recordLoginFailure(ip: string, now = Date.now()): void {
  const entry = failures.get(ip);
  if (!entry || now - entry.first >= WINDOW_MS) {
    failures.set(ip, { first: now, count: 1 });
    return;
  }
  entry.count += 1;
}

export function clearLoginFailures(ip: string): void {
  failures.delete(ip);
}

export function resetLoginThrottle(): void {
  failures.clear();
}
