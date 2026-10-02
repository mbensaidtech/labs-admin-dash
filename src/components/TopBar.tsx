"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { postJson } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/messages";

const LINKS: { href: string; key: "nav.overview" | "nav.matrix" | "nav.help" }[] = [
  { href: "/", key: "nav.overview" },
  { href: "/matrix", key: "nav.matrix" },
  { href: "/help", key: "nav.help" },
];

export function TopBar({ helpCount }: { helpCount?: number }) {
  const { t, locale, setLocale } = useI18n();
  const pathname = usePathname();
  const router = useRouter();

  const logout = async () => {
    await postJson("/api/admin/logout");
    router.replace("/login");
  };

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-panel/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-2">
        <Link href="/" className="mr-2 flex items-center gap-2 font-semibold tracking-tight">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full bg-accent" />
          {t("app.name")}
        </Link>
        <nav aria-label="Main" className="flex flex-wrap items-center gap-1">
          {LINKS.map((link) => {
            const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`rounded px-3 py-1.5 text-sm ${active ? "bg-panel-2 text-text" : "text-muted hover:text-text"}`}
              >
                {t(link.key)}
                {link.key === "nav.help" && helpCount ? (
                  <span className="ml-2 rounded-full bg-red px-1.5 py-0.5 text-xs font-semibold text-white">{helpCount}</span>
                ) : null}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <LocaleSwitch locale={locale} setLocale={setLocale} label={t("lang.aria")} />
          <button type="button" onClick={logout} className="rounded border border-border px-3 py-1.5 text-sm text-muted hover:text-text">
            {t("nav.logout")}
          </button>
        </div>
      </div>
    </header>
  );
}

export function LocaleSwitch({ locale, setLocale, label }: { locale: Locale; setLocale: (locale: Locale) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex overflow-hidden rounded border border-border text-xs">
      {(["en", "fr"] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={locale === value}
          onClick={() => setLocale(value)}
          className={`px-2 py-1 uppercase ${locale === value ? "bg-accent text-white" : "text-muted hover:text-text"}`}
        >
          {value}
        </button>
      ))}
    </div>
  );
}
