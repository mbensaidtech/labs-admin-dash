"use client";

import { useI18n } from "@/lib/i18n/provider";
import { absoluteTime, relativeTime } from "@/lib/i18n/time";

export function RelativeTime({ iso, now }: { iso: string; now: number }) {
  const { t, locale } = useI18n();
  return (
    <time dateTime={iso} title={absoluteTime(iso, locale)}>
      {relativeTime(iso, now, t)}
    </time>
  );
}
