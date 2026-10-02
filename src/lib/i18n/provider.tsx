"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { MESSAGES, type Locale, type MessageKey } from "@/lib/i18n/messages";
import { usePrefWithDefault, writePref } from "@/lib/prefs";

const STORAGE_KEY = "labs-admin-locale";

interface I18n {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18n | null>(null);

function browserLocale(): Locale {
  return navigator.language.toLowerCase().startsWith("fr") ? "fr" : "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const stored = usePrefWithDefault(STORAGE_KEY, browserLocale, "en");
  const locale: Locale = stored === "fr" ? "fr" : "en";

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => writePref(STORAGE_KEY, next), []);

  const value = useMemo<I18n>(
    () => ({
      locale,
      setLocale,
      t: (key, params) => format(MESSAGES[locale][key] ?? MESSAGES.en[key] ?? key, params),
    }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function format(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

export function useI18n(): I18n {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return context;
}
