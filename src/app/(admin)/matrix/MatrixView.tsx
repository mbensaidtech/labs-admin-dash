"use client";

import Link from "next/link";
import { useMatrix, useWorkshops } from "@/lib/api/hooks";
import { useWorkshopScope } from "@/lib/admin/WorkshopScopeProvider";
import { useI18n } from "@/lib/i18n/provider";
import type { MatrixDto } from "@/lib/domain/queries";
import type { LabDisplayState } from "@/lib/domain/states";
import { DisconnectedBanner } from "@/components/DisconnectedBanner";
import { Page } from "@/components/Page";
import { DevStatePill } from "@/components/StatePill";
import { WorkshopLabel } from "@/components/WorkshopLabel";

const CELL: Record<LabDisplayState, string> = {
  notStarted: "bg-panel-2 text-muted",
  inProgress: "bg-accent/25 text-accent",
  running: "bg-purple/30 text-purple pulse",
  staleRun: "bg-amber/25 text-amber",
  completed: "bg-green/30 text-green",
};

const ICON: Record<LabDisplayState, string> = { notStarted: "·", inProgress: "◔", running: "▶", staleRun: "◔", completed: "✓" };

export function MatrixView({ initial }: { initial: MatrixDto }) {
  const { t } = useI18n();
  const { scope } = useWorkshopScope();
  const query = useMatrix(initial, scope);
  const { data: workshops } = useWorkshops();
  const data = query.data ?? initial;
  const scopeName = scope ? workshops?.find((workshop) => workshop.id === scope)?.name : undefined;

  const exportCsv = () => {
    const header = [t("matrix.developer"), ...data.labs.map((lab) => `${lab.number} ${lab.title}`.trim())];
    const rows = data.rows.map((row) => [row.dev.username, ...row.cells.map((cell) => t(`lab.${cell.state}`) + (cell.blocked ? ` (${t("lab.blocked")})` : ""))]);
    const csv = [header, ...rows].map((line) => line.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `labs-matrix-${scopeName ? `${slugify(scopeName)}-` : ""}${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Page
      title={t("matrix.title")}
      actions={
        <button type="button" onClick={exportCsv} disabled={data.rows.length === 0} className="rounded border border-border px-3 py-1.5 text-sm hover:border-accent disabled:opacity-50">
          {t("matrix.export")}
        </button>
      }
    >
      <DisconnectedBanner isError={query.isError} />
      {data.rows.length === 0 || data.labs.length === 0 ? (
        <p className="rounded-lg border border-border bg-panel p-6 text-center text-muted">{t("matrix.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-panel">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 bg-panel px-3 py-2 text-left text-xs font-semibold text-muted">
                  {t("matrix.developer")}
                </th>
                {data.labs.map((lab) => (
                  <th
                    key={lab.id}
                    scope="col"
                    title={lab.declared ? lab.title : `${lab.title} — ${t("lab.undeclared")}`}
                    className={`px-2 py-2 text-center text-xs font-semibold ${lab.declared ? "text-muted" : "text-muted/40"}`}
                  >
                    {lab.number || lab.id}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.dev.id} className="border-t border-border">
                  <th scope="row" className="sticky left-0 bg-panel px-3 py-2 text-left font-medium">
                    <Link href={`/devs/${row.dev.id}`} className="hover:underline">
                      {row.dev.username}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <DevStatePill state={row.dev.state} />
                      {scope ? null : <WorkshopLabel workshop={row.dev.workshop} />}
                    </div>
                  </th>
                  {row.cells.map((cell) => {
                    const result = cell.lastRunStatus ? t(`result.${cell.lastRunStatus}`) : t("common.na");
                    const label = `${t(`lab.${cell.state}`)}${cell.blocked ? ` · ${t("lab.blocked")}` : ""} · ${result} · ${cell.runCount} run(s)`;
                    return (
                      <td key={cell.labId} className="p-1 text-center">
                        <span
                          title={label}
                          aria-label={label}
                          className={`inline-flex h-9 w-9 items-center justify-center rounded text-base font-semibold ${CELL[cell.state]} ${cell.blocked ? "ring-2 ring-red" : ""}`}
                        >
                          {cell.blocked ? "✋" : ICON[cell.state]}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}

function slugify(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "workshop"
  );
}
