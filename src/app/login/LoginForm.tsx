"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiClientError, postJson } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/provider";
import { LocaleSwitch } from "@/components/TopBar";

export function LoginForm({ next }: { next: string }) {
  const { t, locale, setLocale } = useI18n();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await postJson("/api/admin/login", { password });
      router.replace(next);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.status === 401) setError(t("login.error.wrong"));
        else if (err.status === 429) setError(t("login.error.throttled", { seconds: String(err.details?.retryAfterSeconds ?? "") }));
        else if (err.status === 500 && err.details?.missing) setError(t("login.error.config"));
        else setError(t("login.error.generic"));
      } else {
        setError(t("login.error.generic"));
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full bg-accent" />
          {t("app.name")}
        </h1>
        <LocaleSwitch locale={locale} setLocale={setLocale} label={t("lang.aria")} />
      </div>
      <form onSubmit={submit} className="flex flex-col gap-4 rounded-lg border border-border bg-panel p-6">
        <h2 className="text-sm font-semibold text-muted">{t("login.title")}</h2>
        <label className="flex flex-col gap-1 text-sm">
          {t("login.password")}
          <input
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="rounded border border-border bg-bg px-3 py-2 text-text"
          />
        </label>
        {error ? (
          <p role="alert" className="text-sm text-red">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={pending || !password} className="rounded bg-accent px-3 py-2 font-medium text-white disabled:opacity-50">
          {t("login.submit")}
        </button>
      </form>
    </main>
  );
}
