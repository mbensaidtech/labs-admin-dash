"use client";

import { useSyncExternalStore } from "react";

/** Per-viewer preferences in localStorage, read through useSyncExternalStore (hydration-safe, no setState in effects). */
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private window or blocked storage: the value lasts for the page only.
  }
  for (const listener of listeners) listener();
}

export function usePref(key: string, serverValue: string | null = null): string | null {
  return useSyncExternalStore(subscribe, () => readPref(key), () => serverValue);
}

/** Same store, with a client-side default computed when nothing is stored. */
export function usePrefWithDefault(key: string, clientDefault: () => string, serverValue: string): string {
  return useSyncExternalStore(subscribe, () => readPref(key) ?? clientDefault(), () => serverValue);
}
