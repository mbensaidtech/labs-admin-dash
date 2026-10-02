"use client";

import { useEffect, useState } from "react";

/** A shared clock that ticks every `intervalMs` (relative times refresh every 10 s). */
export function useNow(intervalMs = 10_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
