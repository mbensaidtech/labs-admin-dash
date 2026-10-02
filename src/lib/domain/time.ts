/** Clamps a client-reported date to [receivedAt − 24 h, receivedAt + 5 min] (Business Rule 11). */
export function clampOccurredAt(occurredAt: Date, receivedAt: Date): Date {
  const min = receivedAt.getTime() - 24 * 60 * 60 * 1000;
  const max = receivedAt.getTime() + 5 * 60 * 1000;
  const value = occurredAt.getTime();
  if (Number.isNaN(value)) return receivedAt;
  return new Date(Math.min(Math.max(value, min), max));
}

export const ONLINE_MS = 3 * 60 * 1000;
export const IDLE_MS = 30 * 60 * 1000;
