"use client";

import { useI18n } from "@/lib/i18n/provider";

export function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const { t } = useI18n();
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-muted">
        <span>{t("overview.progress", { completed, total })}</span>
        <span>{percent}%</span>
      </div>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={completed} className="h-2 overflow-hidden rounded bg-panel-2">
        <div className="h-full rounded bg-green transition-[width]" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
