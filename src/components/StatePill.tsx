"use client";

import { useI18n } from "@/lib/i18n/provider";
import type { DevState, LabDisplayState } from "@/lib/domain/states";
import type { HelpStatus, RunStatus, FailureStage } from "@/lib/db/types";

const DEV_STYLES: Record<DevState, string> = {
  needsHelp: "bg-red/20 text-red border-red/50",
  running: "bg-purple/20 text-purple border-purple/50",
  online: "bg-green/20 text-green border-green/50",
  idle: "bg-amber/20 text-amber border-amber/50",
  offline: "bg-panel-2 text-muted border-border",
};

const DEV_ICONS: Record<DevState, string> = { needsHelp: "✋", running: "▶", online: "●", idle: "◐", offline: "○" };

export function DevStatePill({ state }: { state: DevState }) {
  const { t } = useI18n();
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${DEV_STYLES[state]} ${state === "needsHelp" ? "pulse" : ""}`}>
      <span aria-hidden>{DEV_ICONS[state]}</span>
      {t(`state.${state}`)}
    </span>
  );
}

const LAB_STYLES: Record<LabDisplayState, string> = {
  notStarted: "bg-panel-2 text-muted border-border",
  inProgress: "bg-accent/20 text-accent border-accent/50",
  running: "bg-purple/20 text-purple border-purple/50",
  staleRun: "bg-amber/20 text-amber border-amber/50",
  completed: "bg-green/20 text-green border-green/50",
};

export function LabStatePill({ state, blocked }: { state: LabDisplayState; blocked?: boolean }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${LAB_STYLES[state]}`}>{t(`lab.${state}`)}</span>
      {blocked ? <span className="inline-flex items-center rounded-full border border-red bg-red/20 px-2 py-0.5 text-xs font-medium text-red">✋ {t("lab.blocked")}</span> : null}
    </span>
  );
}

export function RunResult({ status, failureStage }: { status?: RunStatus; failureStage?: FailureStage }) {
  const { t } = useI18n();
  if (!status) return <span className="text-muted">{t("common.na")}</span>;
  const colour = status === "passed" ? "text-green" : status === "failed" ? "text-red" : status === "running" ? "text-purple" : "text-amber";
  const text = status === "failed" && failureStage ? t("result.failedStage", { stage: t(`stage.${failureStage}`) }) : t(`result.${status}`);
  return <span className={colour}>{text}</span>;
}

const HELP_STYLES: Record<HelpStatus, string> = {
  open: "bg-red/20 text-red border-red/50",
  acknowledged: "bg-amber/20 text-amber border-amber/50",
  resolved: "bg-green/20 text-green border-green/50",
  cancelled: "bg-panel-2 text-muted border-border",
};

export function HelpStatusPill({ status }: { status: HelpStatus }) {
  const { t } = useI18n();
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${HELP_STYLES[status]}`}>{t(`help.status.${status}`)}</span>;
}
