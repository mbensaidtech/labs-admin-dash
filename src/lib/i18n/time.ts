import type { MessageKey } from "@/lib/i18n/messages";

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

/** "3 min ago" style text from an ISO date, computed against a shared `now`. */
export function relativeTime(iso: string, now: number, t: T): string {
  const diff = now - Date.parse(iso);
  if (Number.isNaN(diff)) return t("common.na");
  if (diff < -30_000) return t("time.inFuture");
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return t("time.justNow");
  if (minutes < 60) return t("time.minutes", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("time.hours", { n: hours });
  return t("time.days", { n: Math.floor(hours / 24) });
}

export function durationText(ms: number | undefined, t: T): string {
  if (ms === undefined || ms === null) return t("common.na");
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return t("duration.seconds", { n: seconds });
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return t("duration.minutes", { n: minutes });
  return t("duration.hours", { n: Math.round(minutes / 60) });
}

/** Elapsed time since an ISO date ("12 min"), for the help queue. */
export function elapsedText(iso: string, now: number, t: T): string {
  return durationText(Math.max(0, now - Date.parse(iso)), t);
}

export function absoluteTime(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });
}
