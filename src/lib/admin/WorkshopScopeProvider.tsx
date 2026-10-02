"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/** Mirror of SCOPE_COOKIE (server side), kept here so this client module never imports server code. */
const COOKIE = "labs-admin-workshop";
const ONE_YEAR = 365 * 24 * 3600;

interface WorkshopScopeValue {
  /** Selected workshop id, or null for "All workshops". */
  scope: string | null;
  setScope: (scope: string | null) => void;
}

const WorkshopScopeContext = createContext<WorkshopScopeValue | null>(null);

function writeCookie(scope: string | null) {
  document.cookie = scope
    ? `${COOKIE}=${encodeURIComponent(scope)}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax`
    : `${COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/** The workshop picked in the top bar, remembered in a cookie so server pages render the same scope first. */
export function WorkshopScopeProvider({ initialScope, children }: { initialScope: string | null; children: ReactNode }) {
  const [scope, setScopeState] = useState<string | null>(initialScope);
  const setScope = useCallback((next: string | null) => {
    writeCookie(next);
    setScopeState(next);
  }, []);
  const value = useMemo(() => ({ scope, setScope }), [scope, setScope]);
  return <WorkshopScopeContext.Provider value={value}>{children}</WorkshopScopeContext.Provider>;
}

export function useWorkshopScope(): WorkshopScopeValue {
  const context = useContext(WorkshopScopeContext);
  if (!context) {
    throw new Error("useWorkshopScope must be used inside WorkshopScopeProvider");
  }
  return context;
}

export function scopeQuery(scope: string | null, prefix: "?" | "&" = "?"): string {
  return scope ? `${prefix}workshopId=${encodeURIComponent(scope)}` : "";
}
