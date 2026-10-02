import type { MessageKey } from "@/lib/i18n/messages";

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

const KNOWN: ReadonlySet<string> = new Set<MessageKey>([
  "event.catalog.synced", "event.progress.snapshot", "event.lab.opened", "event.run.started", "event.run.finished",
  "event.solution.viewed", "event.heartbeat", "event.settings.changed", "event.help.requested", "event.help.cancelled",
  "event.help.resolved", "event.dev.registered",
]);

/** Human label of an event type; unknown types are shown as "Other event (type)". */
export function eventLabel(type: string, t: T): string {
  const key = `event.${type}`;
  return KNOWN.has(key) ? t(key as MessageKey) : `${t("event.other")} (${type})`;
}
