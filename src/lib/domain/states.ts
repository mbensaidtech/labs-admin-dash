import type { DevDoc, LabProgress } from "@/lib/db/types";
import { IDLE_MS, ONLINE_MS } from "@/lib/domain/time";

export type DevState = "needsHelp" | "running" | "online" | "idle" | "offline";

export const DEV_STATE_ORDER: Record<DevState, number> = {
  needsHelp: 0,
  running: 1,
  online: 2,
  idle: 3,
  offline: 4,
};

export type LabDisplayState = "notStarted" | "inProgress" | "running" | "staleRun" | "completed";

export function isOnline(dev: Pick<DevDoc, "lastSeenAt">, now: Date): boolean {
  return now.getTime() - dev.lastSeenAt.getTime() < ONLINE_MS;
}

export function activeRunLab(dev: Pick<DevDoc, "progress">): string | undefined {
  return Object.entries(dev.progress ?? {}).find(([, progress]) => progress.activeRunId)?.[0];
}

/** Developer state, first matching row wins (Derived States). */
export function devState(dev: Pick<DevDoc, "lastSeenAt" | "progress">, needsHelp: boolean, now: Date): DevState {
  if (needsHelp) return "needsHelp";
  const online = isOnline(dev, now);
  if (online && activeRunLab(dev)) return "running";
  if (online) return "online";
  if (now.getTime() - dev.lastSeenAt.getTime() < IDLE_MS) return "idle";
  return "offline";
}

/** Display state of one lab for one developer. */
export function labDisplayState(progress: LabProgress | undefined, online: boolean): LabDisplayState {
  if (!progress) return "notStarted";
  if (progress.state === "completed") return "completed";
  if (progress.activeRunId) return online ? "running" : "staleRun";
  return progress.state;
}

export function completedCount(dev: Pick<DevDoc, "progress" | "catalogLabIds">): { completed: number; total: number } {
  const labIds = dev.catalogLabIds?.length ? dev.catalogLabIds : Object.keys(dev.progress ?? {});
  const completed = labIds.filter((labId) => dev.progress?.[labId]?.state === "completed").length;
  return { completed, total: labIds.length };
}
