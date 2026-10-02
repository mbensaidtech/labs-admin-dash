"use client";

import Link from "next/link";
import { useState } from "react";
import { fetchEventPage, useArchiveMutation, useDevDetail } from "@/lib/api/hooks";
import { useNow } from "@/lib/api/useNow";
import { useI18n } from "@/lib/i18n/provider";
import { absoluteTime, durationText } from "@/lib/i18n/time";
import type { DevDetailDto, EventDto } from "@/lib/domain/queries";
import { DisconnectedBanner } from "@/components/DisconnectedBanner";
import { HelpActions } from "@/components/HelpActions";
import { Page, Panel } from "@/components/Page";
import { ProgressBar } from "@/components/ProgressBar";
import { RelativeTime } from "@/components/RelativeTime";
import { DevStatePill, HelpStatusPill, LabStatePill, RunResult } from "@/components/StatePill";
import { eventLabel } from "@/lib/i18n/events";

export function DevDetailView({ id, initial }: { id: string; initial: DevDetailDto }) {
  const { t, locale } = useI18n();
  const query = useDevDetail(id, initial);
  const archive = useArchiveMutation(id);
  const now = useNow();
  const data = query.data ?? initial;
  const [extraEvents, setExtraEvents] = useState<EventDto[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const nextCursor = cursor === undefined ? data.nextCursor : cursor;
  const labTitle = (labId?: string) => (labId ? (data.progress.find((p) => p.labId === labId)?.lab.title ?? labId) : t("common.na"));

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await fetchEventPage(id, nextCursor);
      setExtraEvents((previous) => [...previous, ...page.items]);
      setCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };

  const seen = new Set<string>();
  const events = [...data.events, ...extraEvents].filter((event) => (seen.has(event.id) ? false : (seen.add(event.id), true)));

  return (
    <Page
      title={data.dev.username}
      actions={
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm text-muted hover:text-text">
            ← {t("dev.back")}
          </Link>
          <button
            type="button"
            disabled={archive.isPending}
            onClick={() => archive.mutate({ archived: !data.dev.archived })}
            className="rounded border border-border px-3 py-1.5 text-sm hover:border-accent disabled:opacity-50"
          >
            {data.dev.archived ? t("dev.unarchive") : t("dev.archive")}
          </button>
        </div>
      }
    >
      <DisconnectedBanner isError={query.isError} />
      {data.dev.archived ? <p className="mb-4 rounded border border-amber/50 bg-amber/10 px-4 py-2 text-sm text-amber">{t("dev.archived")}</p> : null}

      <Panel className="mb-4">
        <div className="flex flex-wrap items-center gap-4">
          <DevStatePill state={data.dev.state} />
          <span className="font-mono text-xs text-muted">{data.dev.id}</span>
          <span className="text-sm text-muted">
            {t("dev.since", { time: absoluteTime(data.dev.createdAt, locale) })}
          </span>
          <span className="text-sm text-muted">
            {t("dev.platform")}: {data.dev.platform ?? t("common.na")} · {t("dev.version")}: {data.dev.dashboardVersion ?? t("common.na")}
          </span>
          <span className="text-sm text-muted">
            {t("overview.lastActivity")}: <RelativeTime iso={data.dev.lastActivityAt} now={now} />
          </span>
        </div>
        <div className="mt-4 max-w-md">
          <ProgressBar completed={data.dev.completed} total={data.dev.total} />
        </div>
      </Panel>

      <Panel title={t("dev.labs")} className="mb-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-1 pr-3">{t("dev.col.lab")}</th>
                <th className="py-1 pr-3">{t("dev.col.state")}</th>
                <th className="py-1 pr-3">{t("dev.col.lastResult")}</th>
                <th className="py-1 pr-3 text-right">{t("dev.col.runs")}</th>
                <th className="py-1 pr-3 text-right">{t("dev.col.solutionRuns")}</th>
                <th className="py-1 pr-3 text-right">{t("dev.col.tokens")}</th>
                <th className="py-1">{t("dev.col.completedAt")}</th>
              </tr>
            </thead>
            <tbody>
              {data.progress.map((p) => (
                <tr key={p.labId} className="border-t border-border">
                  <td className="py-2 pr-3">
                    <span className="text-muted">{p.lab.number}</span> {p.lab.title}
                  </td>
                  <td className="py-2 pr-3">
                    <LabStatePill state={p.display} blocked={p.blocked} />
                  </td>
                  <td className="py-2 pr-3">
                    <RunResult status={p.lastRunStatus} failureStage={lastFailureStage(data, p.labId)} />
                    {p.lastRunTarget === "solution" && p.lastRunStatus === "passed" && p.state !== "completed" ? <span className="ml-2 text-xs text-muted">({t("lab.solutionPassed")})</span> : null}
                    {p.solutionViewedAt ? <span className="ml-2 text-xs text-muted">· {t("lab.solutionViewed")}</span> : null}
                  </td>
                  <td className="py-2 pr-3 text-right">{p.runCount}</td>
                  <td className="py-2 pr-3 text-right">{p.solutionRunCount}</td>
                  <td className="py-2 pr-3 text-right">{p.totalTokens.toLocaleString(locale)}</td>
                  <td className="py-2">{p.completedAt ? absoluteTime(p.completedAt, locale) : t("common.na")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title={t("dev.runs")}>
          {data.runs.length === 0 ? (
            <p className="text-sm text-muted">{t("dev.noRuns")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    <th className="py-1 pr-3">{t("dev.col.when")}</th>
                    <th className="py-1 pr-3">{t("dev.col.lab")}</th>
                    <th className="py-1 pr-3">{t("dev.col.target")}</th>
                    <th className="py-1 pr-3">{t("dev.col.status")}</th>
                    <th className="py-1 pr-3">{t("dev.col.duration")}</th>
                    <th className="py-1 pr-3">{t("dev.col.checks")}</th>
                    <th className="py-1">{t("dev.col.summary")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.runs.map((run) => (
                    <tr key={run.id} className="border-t border-border align-top">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <RelativeTime iso={run.startedAt} now={now} />
                      </td>
                      <td className="py-2 pr-3">{labTitle(run.labId)}</td>
                      <td className="py-2 pr-3">{t(`target.${run.target}`)}</td>
                      <td className="py-2 pr-3">
                        <RunResult status={run.status} failureStage={run.failureStage} />
                      </td>
                      <td className="py-2 pr-3">{durationText(run.durationMs, t)}</td>
                      <td className="py-2 pr-3">{run.checksTotal !== undefined ? `${run.checksPassed ?? 0}/${run.checksTotal}` : t("common.na")}</td>
                      <td className="py-2 text-xs text-muted">{run.summary ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title={t("dev.helpRequests")}>
          {data.helpRequests.length === 0 ? (
            <p className="text-sm text-muted">{t("dev.noHelp")}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {data.helpRequests.map((request) => (
                <li key={request.id} className="rounded border border-border bg-panel-2 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <HelpStatusPill status={request.status} />
                    <span className="text-muted">{request.labId ? labTitle(request.labId) : t("help.noLab")}</span>
                    <span className="text-xs text-muted">{absoluteTime(request.createdAt, locale)}</span>
                    {request.status === "open" || request.status === "acknowledged" ? (
                      <span className="ml-auto">
                        <HelpActions id={request.id} status={request.status} compact />
                      </span>
                    ) : null}
                  </div>
                  {request.message ? <p className="mt-1 italic text-muted">“{request.message}”</p> : null}
                  {request.adminNote ? <p className="mt-1 text-green">↳ {request.adminNote}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title={t("dev.feed")} className="mt-4">
        {events.length === 0 ? (
          <p className="text-sm text-muted">{t("dev.noEvents")}</p>
        ) : (
          <ol className="flex flex-col gap-1 text-sm">
            {events.map((event) => (
              <li key={event.id} className="flex flex-wrap items-baseline gap-2 border-t border-border py-1.5 first:border-t-0">
                <span className="w-24 shrink-0 text-xs text-muted" title={absoluteTime(event.occurredAt, locale)}>
                  <RelativeTime iso={event.receivedAt} now={now} />
                </span>
                <span className="font-medium">{eventLabel(event.type, t)}</span>
                {event.labId ? <span className="text-muted">{labTitle(event.labId)}</span> : null}
                {event.late ? <span className="rounded bg-amber/20 px-1.5 text-xs text-amber">{t("event.late")}</span> : null}
                <span className="truncate font-mono text-xs text-muted/70">{summarisePayload(event.payload)}</span>
              </li>
            ))}
          </ol>
        )}
        {nextCursor ? (
          <button type="button" onClick={loadMore} disabled={loadingMore} className="mt-3 rounded border border-border px-3 py-1.5 text-sm hover:border-accent disabled:opacity-50">
            {loadingMore ? t("common.loading") : t("dev.loadMore")}
          </button>
        ) : null}
      </Panel>
    </Page>
  );
}

function lastFailureStage(data: DevDetailDto, labId: string) {
  const run = data.runs.find((candidate) => candidate.labId === labId && candidate.status !== "running");
  return run?.failureStage;
}

function summarisePayload(payload: unknown): string {
  if (payload === null || payload === undefined) return "";
  if (typeof payload !== "object") return String(payload);
  const text = JSON.stringify(payload);
  return text === "{}" ? "" : text.length > 120 ? `${text.slice(0, 117)}…` : text;
}
