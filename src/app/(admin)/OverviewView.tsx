"use client";

import Link from "next/link";
import { useOverview } from "@/lib/api/hooks";
import { useWorkshopScope } from "@/lib/admin/WorkshopScopeProvider";
import { useNow } from "@/lib/api/useNow";
import { useI18n } from "@/lib/i18n/provider";
import { elapsedText } from "@/lib/i18n/time";
import { eventLabel } from "@/lib/i18n/events";
import type { OverviewDto } from "@/lib/domain/queries";
import { DisconnectedBanner } from "@/components/DisconnectedBanner";
import { HelpActions } from "@/components/HelpActions";
import { Page } from "@/components/Page";
import { ProgressBar } from "@/components/ProgressBar";
import { RelativeTime } from "@/components/RelativeTime";
import { DevStatePill } from "@/components/StatePill";
import { WorkshopLabel } from "@/components/WorkshopLabel";

export function OverviewView({ initial }: { initial: OverviewDto }) {
  const { t } = useI18n();
  const { scope } = useWorkshopScope();
  const query = useOverview(initial, scope);
  const now = useNow();
  const data = query.data ?? initial;
  const labTitle = (id?: string) => (id ? (data.labs.find((lab) => lab.id === id)?.title ?? id) : undefined);
  const openRequests = data.helpRequests.filter((request) => request.status === "open" || request.status === "acknowledged");

  return (
    <Page title={t("overview.title")}>
      <DisconnectedBanner isError={query.isError} />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Counter label={t("counters.devs")} value={data.counters.devs} />
        <Counter label={t("counters.online")} value={data.counters.online} colour="text-green" />
        <Counter label={t("counters.running")} value={data.counters.running} colour="text-purple" />
        <Counter label={t("counters.needsHelp")} value={data.counters.needsHelp} colour={data.counters.needsHelp ? "text-red" : undefined} />
        <Counter label={t("counters.completedToday")} value={data.counters.completedToday} hint={`${t("counters.completedLabs")}: ${data.counters.completedLabs}`} />
      </div>

      {openRequests.length > 0 ? (
        <section aria-live="polite" className="mb-4 rounded-lg border border-red/50 bg-red/10 p-4">
          <h2 className="mb-2 text-sm font-semibold text-red">✋ {t("overview.helpBanner", { count: openRequests.length })}</h2>
          <ul className="flex flex-col gap-2">
            {openRequests.map((request) => (
              <li key={request.id} className="flex flex-wrap items-center gap-3 text-sm">
                <Link href={`/devs/${request.dev.id}`} className="font-medium underline-offset-2 hover:underline">
                  {request.dev.username}
                </Link>
                {scope ? null : <WorkshopLabel workshop={request.workshop} />}
                <span className="text-muted">{request.lab?.title ?? request.labId ?? t("help.noLab")}</span>
                {request.message ? <span className="italic text-muted">“{request.message}”</span> : null}
                <span className="text-xs text-muted">{t("help.waitingFor", { duration: elapsedText(request.createdAt, now, t) })}</span>
                <span className="ml-auto">
                  <HelpActions id={request.id} status={request.status} compact />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.workshopCount === 0 && data.devs.length === 0 ? (
        <section className="rounded-lg border border-border bg-panel p-6 text-center">
          <h2 className="mb-1 font-semibold">{t("workshops.firstTitle")}</h2>
          <p className="mb-4 text-sm text-muted">{t("workshops.firstBody")}</p>
          <Link href="/workshops" className="inline-block rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">
            {t("workshops.firstAction")}
          </Link>
        </section>
      ) : data.devs.length === 0 ? (
        <p className="rounded-lg border border-border bg-panel p-6 text-center text-muted">{t("overview.empty")}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.devs.map((dev) => (
            <li key={dev.id}>
              <Link
                href={`/devs/${dev.id}`}
                aria-label={t("overview.open", { username: dev.username })}
                className={`block h-full rounded-lg border bg-panel p-4 transition-colors hover:border-accent ${dev.state === "needsHelp" ? "border-red/60" : "border-border"}`}
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{dev.username}</div>
                    <div className="font-mono text-xs text-muted">{dev.id.slice(0, 8)}</div>
                    {scope ? null : (
                      <div className="mt-1">
                        <WorkshopLabel workshop={dev.workshop} />
                      </div>
                    )}
                  </div>
                  <DevStatePill state={dev.state} />
                </div>
                <ProgressBar completed={dev.completed} total={dev.total} />
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted">{t("overview.currentLab")}</dt>
                  <dd className="truncate">{labTitle(dev.currentLab) ?? t("common.na")}</dd>
                  <dt className="text-muted">{t("overview.lastActivity")}</dt>
                  <dd>
                    <RelativeTime iso={dev.lastActivityAt} now={now} />
                    {dev.lastActivityType ? <span className="text-muted"> · {eventLabel(dev.lastActivityType, t)}</span> : null}
                  </dd>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

function Counter({ label, value, colour, hint }: { label: string; value: number; colour?: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-panel px-4 py-3" title={hint}>
      <div className="text-xs text-muted">{label}</div>
      <div className={`text-2xl font-semibold ${colour ?? ""}`}>{value}</div>
    </div>
  );
}
