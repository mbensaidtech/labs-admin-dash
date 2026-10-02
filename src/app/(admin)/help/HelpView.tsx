"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePref, writePref } from "@/lib/prefs";
import { useHelpQueue } from "@/lib/api/hooks";
import { useNow } from "@/lib/api/useNow";
import { useI18n } from "@/lib/i18n/provider";
import { absoluteTime, elapsedText } from "@/lib/i18n/time";
import type { HelpQueueItemDto } from "@/lib/domain/queries";
import { DisconnectedBanner } from "@/components/DisconnectedBanner";
import { HelpActions } from "@/components/HelpActions";
import { Page } from "@/components/Page";
import { HelpStatusPill } from "@/components/StatePill";

const SOUND_KEY = "labs-admin-help-sound";

function beep() {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 880;
    gain.gain.value = 0.08;
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.25);
    oscillator.onended = () => void context.close();
  } catch {
    // No audio available: the visual cue is enough.
  }
}

export function HelpView({ initialActive, initialHistory }: { initialActive: HelpQueueItemDto[]; initialHistory: HelpQueueItemDto[] }) {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<"active" | "history">("active");
  const sound = usePref(SOUND_KEY) === "1";
  const active = useHelpQueue("open,acknowledged", initialActive);
  const history = useHelpQueue("resolved,cancelled", initialHistory);
  const now = useNow();
  const knownIds = useRef<Set<string> | null>(null);

  // One beep per request that was not in the previous poll (never on the first render).
  useEffect(() => {
    const items = active.data ?? [];
    if (knownIds.current === null) {
      knownIds.current = new Set(items.map((item) => item.id));
      return;
    }
    const fresh = items.filter((item) => !knownIds.current!.has(item.id));
    knownIds.current = new Set(items.map((item) => item.id));
    if (fresh.length > 0 && sound) beep();
  }, [active.data, sound]);

  const toggleSound = () => {
    const next = !sound;
    writePref(SOUND_KEY, next ? "1" : "0");
    if (next) beep();
  };

  const list = tab === "active" ? (active.data ?? initialActive) : (history.data ?? initialHistory);

  return (
    <Page
      title={t("help.title")}
      actions={
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={sound} onChange={toggleSound} className="h-4 w-4 accent-accent" />
          {t("help.sound")}
        </label>
      }
    >
      <DisconnectedBanner isError={active.isError} />
      <div role="tablist" className="mb-4 flex gap-1 border-b border-border">
        {(["active", "history"] as const).map((value) => (
          <button
            key={value}
            role="tab"
            type="button"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === value ? "border-accent text-text" : "border-transparent text-muted hover:text-text"}`}
          >
            {t(`help.tab.${value}`)}
            {value === "active" && active.data?.length ? <span className="ml-2 rounded-full bg-red px-1.5 text-xs font-semibold text-white">{active.data.length}</span> : null}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <p className="rounded-lg border border-border bg-panel p-6 text-center text-muted">{tab === "active" ? t("help.empty") : t("help.emptyHistory")}</p>
      ) : (
        <ul role="tabpanel" aria-live="polite" className="flex flex-col gap-2">
          {list.map((request) => (
            <li key={request.id} className={`rounded-lg border bg-panel p-4 ${request.status === "open" ? "border-red/60" : "border-border"}`}>
              <div className="flex flex-wrap items-center gap-3">
                <HelpStatusPill status={request.status} />
                <Link href={`/devs/${request.dev.id}`} className="font-semibold hover:underline">
                  {request.dev.username}
                </Link>
                <span className="text-sm text-muted">{request.lab ? `${request.lab.number} · ${request.lab.title}` : (request.labId ?? t("help.noLab"))}</span>
                <span className="text-xs text-muted" title={absoluteTime(request.createdAt, locale)}>
                  {tab === "active" ? t("help.waitingFor", { duration: elapsedText(request.createdAt, now, t) }) : absoluteTime(request.closedAt ?? request.createdAt, locale)}
                  {request.closedBy ? ` · ${t(`help.closedBy.${request.closedBy}`)}` : ""}
                </span>
                {tab === "active" ? (
                  <span className="ml-auto">
                    <HelpActions id={request.id} status={request.status} />
                  </span>
                ) : null}
              </div>
              {request.message ? <p className="mt-2 text-sm italic text-muted">“{request.message}”</p> : null}
              {request.adminNote ? <p className="mt-2 text-sm text-green">↳ {request.adminNote}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
