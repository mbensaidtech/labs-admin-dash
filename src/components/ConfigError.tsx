"use client";

import { useI18n } from "@/lib/i18n/provider";

export function ConfigError({ missing }: { missing: string[] }) {
  const { t } = useI18n();
  return (
    <main className="mx-auto flex max-w-xl flex-1 flex-col justify-center gap-3 px-4 py-10">
      <h1 className="text-xl font-semibold">{t("config.title")}</h1>
      <p className="text-muted">{t("config.body", { names: missing.join(", ") })}</p>
    </main>
  );
}
