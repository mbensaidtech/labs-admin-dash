"use client";

import { useState } from "react";
import { useNow } from "@/lib/api/useNow";
import { useI18n } from "@/lib/i18n/provider";

/** Shown while polling fails: the last known data stays on screen (TanStack Query keeps it). */
export function DisconnectedBanner({ isError }: { isError: boolean }) {
  const { t, locale } = useI18n();
  const now = useNow();
  const [since, setSince] = useState<number | null>(null);

  // State derived from the previous render (React's "storing information from previous renders" pattern).
  if (isError && since === null) setSince(now);
  if (!isError && since !== null) setSince(null);

  if (!isError) return null;
  const time = new Date(since ?? now).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return (
    <div role="status" className="mb-4 rounded border border-amber/50 bg-amber/10 px-4 py-2 text-sm text-amber">
      {t("banner.disconnected", { time })}
    </div>
  );
}
