import type { WorkshopRefDto } from "@/lib/domain/workshops";

/** Small tag naming a developer's workshop, shown in "All workshops" mode only. */
export function WorkshopLabel({ workshop }: { workshop?: WorkshopRefDto }) {
  if (!workshop) return null;
  return (
    <span title={workshop.name} className="inline-block max-w-40 truncate rounded border border-border bg-panel-2 px-1.5 py-0.5 align-middle text-xs text-muted">
      {workshop.name}
    </span>
  );
}
