"use client";

import { useEffect } from "react";
import { useWorkshops } from "@/lib/api/hooks";
import { useWorkshopScope } from "@/lib/admin/WorkshopScopeProvider";
import { useI18n } from "@/lib/i18n/provider";

const ALL = "";

/** Top-bar dropdown scoping every admin page: "All workshops", active ones (newest first), then a Closed group. */
export function WorkshopSelector() {
  const { t } = useI18n();
  const { scope, setScope } = useWorkshopScope();
  const { data: workshops } = useWorkshops();

  // The remembered workshop was deleted (here or in another tab): fall back to every workshop.
  useEffect(() => {
    if (scope && workshops && !workshops.some((workshop) => workshop.id === scope)) {
      setScope(null);
    }
  }, [scope, workshops, setScope]);

  const active = workshops?.filter((workshop) => workshop.status === "active") ?? [];
  const closed = workshops?.filter((workshop) => workshop.status === "closed") ?? [];

  return (
    <select
      aria-label={t("scope.aria")}
      value={scope ?? ALL}
      onChange={(event) => setScope(event.target.value || null)}
      className="min-w-0 max-w-36 truncate rounded border sm:max-w-48 border-border bg-panel-2 px-2 py-1.5 text-sm text-text"
    >
      <option value={ALL}>{t("scope.all")}</option>
      {active.map((workshop) => (
        <option key={workshop.id} value={workshop.id}>
          {workshop.name}
        </option>
      ))}
      {closed.length > 0 ? (
        <optgroup label={t("scope.closed")}>
          {closed.map((workshop) => (
            <option key={workshop.id} value={workshop.id}>
              {workshop.name}
            </option>
          ))}
        </optgroup>
      ) : null}
      {/* Keeps the select controlled while the list is still loading. */}
      {scope && !workshops ? <option value={scope}>…</option> : null}
    </select>
  );
}
