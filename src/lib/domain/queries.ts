import type { Filter } from "mongodb";
import { ApiError } from "@/lib/api/errors";
import { getCollections } from "@/lib/db/client";
import { ACTIVE_HELP_STATUSES, type DevDoc, type EventDoc, type HelpStatus, type LabDoc, type LabProgress, type RunDoc } from "@/lib/db/types";
import { toHelpDto, type HelpRequestDto } from "@/lib/domain/help";
import { activeRunLab, completedCount, devState, isOnline, labDisplayState, DEV_STATE_ORDER, type DevState, type LabDisplayState } from "@/lib/domain/states";

export interface LabDto {
  id: string;
  number: string;
  track: string;
  title: string;
  level: string;
  interactive: boolean;
  sortOrder: number;
}

export interface DevSummaryDto {
  id: string;
  username: string;
  state: DevState;
  lastSeenAt: string;
  lastActivityAt: string;
  lastActivityType?: string;
  lastActivityLab?: string;
  completed: number;
  total: number;
  currentLab?: string;
  activeHelpRequestId?: string;
  archived: boolean;
}

export interface OverviewDto {
  serverTime: string;
  counters: { devs: number; online: number; running: number; needsHelp: number; completedLabs: number; completedToday: number };
  labs: LabDto[];
  devs: DevSummaryDto[];
  helpRequests: HelpQueueItemDto[];
}

export interface HelpQueueItemDto extends HelpRequestDto {
  dev: { id: string; username: string };
  lab?: LabDto;
}

export interface LabProgressDto {
  labId: string;
  lab: LabDto;
  display: LabDisplayState;
  state: LabProgress["state"];
  blocked: boolean;
  activeRunId?: string;
  runCount: number;
  solutionRunCount: number;
  firstRunAt?: string;
  lastRunAt?: string;
  lastRunStatus?: LabProgress["lastRunStatus"];
  lastRunTarget?: LabProgress["lastRunTarget"];
  completedAt?: string;
  solutionViewedAt?: string;
  totalTokens: number;
}

export interface RunDto {
  id: string;
  labId: string;
  target: RunDoc["target"];
  status: RunDoc["status"];
  failureStage?: RunDoc["failureStage"];
  summary?: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  checksPassed?: number;
  checksTotal?: number;
  totalTokens?: number;
}

export interface EventDto {
  id: string;
  devId: string;
  type: string;
  labId?: string;
  occurredAt: string;
  receivedAt: string;
  late: boolean;
  payload: unknown;
}

export interface DevDetailDto {
  serverTime: string;
  dev: DevSummaryDto & { createdAt: string; platform?: string; dashboardVersion?: string; archivedAt?: string };
  progress: LabProgressDto[];
  runs: RunDto[];
  helpRequests: HelpRequestDto[];
  events: EventDto[];
  nextCursor: string | null;
}

export interface MatrixDto {
  serverTime: string;
  labs: (LabDto & { declared: boolean })[];
  rows: { dev: DevSummaryDto; cells: { labId: string; state: LabDisplayState; lastRunStatus?: LabProgress["lastRunStatus"]; runCount: number; blocked: boolean }[] }[];
}

export function toLabDto(lab: LabDoc): LabDto {
  return { id: lab._id, number: lab.number, track: lab.track, title: lab.title, level: lab.level, interactive: lab.interactive, sortOrder: lab.sortOrder };
}

function sortLabs(labs: LabDoc[]): LabDoc[] {
  return [...labs].sort((a, b) => a.sortOrder - b.sortOrder || a.number.localeCompare(b.number) || a._id.localeCompare(b._id));
}

function toDevSummary(dev: DevDoc, activeHelp: Map<string, string>, now: Date): DevSummaryDto {
  const helpId = activeHelp.get(dev._id);
  const state = devState(dev, helpId !== undefined, now);
  const { completed, total } = completedCount(dev);
  const currentLab = activeRunLab(dev) ?? dev.lastActivityLab ?? undefined;
  return {
    id: dev._id,
    username: dev.username,
    state,
    lastSeenAt: dev.lastSeenAt.toISOString(),
    lastActivityAt: dev.lastActivityAt.toISOString(),
    ...(dev.lastActivityType ? { lastActivityType: dev.lastActivityType } : {}),
    ...(dev.lastActivityLab ? { lastActivityLab: dev.lastActivityLab } : {}),
    completed,
    total,
    ...(currentLab ? { currentLab } : {}),
    ...(helpId ? { activeHelpRequestId: helpId } : {}),
    archived: Boolean(dev.archivedAt),
  };
}

function sortDevs(devs: DevSummaryDto[]): DevSummaryDto[] {
  return devs.sort(
    (a, b) => DEV_STATE_ORDER[a.state] - DEV_STATE_ORDER[b.state] || b.lastActivityAt.localeCompare(a.lastActivityAt) || a.username.localeCompare(b.username),
  );
}

async function activeHelpByDev(): Promise<Map<string, string>> {
  const { helpRequests } = await getCollections();
  const active = await helpRequests.find({ status: { $in: [...ACTIVE_HELP_STATUSES] } }, { projection: { _id: 1, devId: 1 } }).toArray();
  return new Map(active.map((request) => [request.devId, request._id]));
}

export async function getOverview(now = new Date()): Promise<OverviewDto> {
  const { devs, labs } = await getCollections();
  const [devDocs, labDocs, activeHelp, queue] = await Promise.all([
    devs.find({ $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }] }).toArray(),
    labs.find({}).toArray(),
    activeHelpByDev(),
    listHelpRequests(["open", "acknowledged"]),
  ]);

  const summaries = sortDevs(devDocs.map((dev) => toDevSummary(dev, activeHelp, now)));
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);
  let completedLabs = 0;
  let completedToday = 0;
  for (const dev of devDocs) {
    for (const progress of Object.values(dev.progress ?? {})) {
      if (progress.state === "completed") {
        completedLabs += 1;
        if (progress.completedAt && progress.completedAt >= startOfDay) completedToday += 1;
      }
    }
  }

  return {
    serverTime: now.toISOString(),
    counters: {
      devs: summaries.length,
      online: devDocs.filter((dev) => isOnline(dev, now)).length,
      running: devDocs.filter((dev) => isOnline(dev, now) && activeRunLab(dev)).length,
      needsHelp: summaries.filter((dev) => dev.state === "needsHelp").length,
      completedLabs,
      completedToday,
    },
    labs: sortLabs(labDocs).map(toLabDto),
    devs: summaries,
    helpRequests: queue,
  };
}

export async function listHelpRequests(statuses: HelpStatus[], limit = 200): Promise<HelpQueueItemDto[]> {
  const { helpRequests, devs, labs } = await getCollections();
  const activeOnly = statuses.every((status) => ACTIVE_HELP_STATUSES.includes(status));
  const docs = await helpRequests
    .find({ status: { $in: statuses } })
    .sort(activeOnly ? { createdAt: 1 } : { closedAt: -1, createdAt: -1 })
    .limit(limit)
    .toArray();
  if (docs.length === 0) return [];

  const devIds = [...new Set(docs.map((doc) => doc.devId))];
  const labIds = [...new Set(docs.flatMap((doc) => (doc.labId ? [doc.labId] : [])))];
  const [devDocs, labDocs] = await Promise.all([
    devs.find({ _id: { $in: devIds } }, { projection: { username: 1 } }).toArray(),
    labIds.length ? labs.find({ _id: { $in: labIds } }).toArray() : Promise.resolve([] as LabDoc[]),
  ]);
  const usernames = new Map(devDocs.map((dev) => [dev._id, dev.username]));
  const labMap = new Map(labDocs.map((lab) => [lab._id, toLabDto(lab)]));

  return docs.map((doc) => ({
    ...toHelpDto(doc),
    dev: { id: doc.devId, username: usernames.get(doc.devId) ?? doc.devId.slice(0, 8) },
    ...(doc.labId && labMap.has(doc.labId) ? { lab: labMap.get(doc.labId) } : {}),
  }));
}

export async function getMatrix(now = new Date()): Promise<MatrixDto> {
  const { devs, labs, helpRequests } = await getCollections();
  const [devDocs, labDocs, activeHelp, activeRequests] = await Promise.all([
    devs.find({ $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }] }).toArray(),
    labs.find({}).toArray(),
    activeHelpByDev(),
    helpRequests.find({ status: { $in: [...ACTIVE_HELP_STATUSES] } }, { projection: { devId: 1, labId: 1 } }).toArray(),
  ]);
  const blocked = new Set(activeRequests.filter((request) => request.labId).map((request) => `${request.devId}/${request.labId}`));
  const declared = new Set(devDocs.flatMap((dev) => dev.catalogLabIds ?? []));
  const sortedLabs = sortLabs(labDocs);

  const rows = sortDevs(devDocs.map((dev) => toDevSummary(dev, activeHelp, now))).map((summary) => {
    const dev = devDocs.find((doc) => doc._id === summary.id)!;
    const online = isOnline(dev, now);
    return {
      dev: summary,
      cells: sortedLabs.map((lab) => {
        const progress = dev.progress?.[lab._id];
        return {
          labId: lab._id,
          state: labDisplayState(progress, online),
          ...(progress?.lastRunStatus ? { lastRunStatus: progress.lastRunStatus } : {}),
          runCount: progress?.runCount ?? 0,
          blocked: blocked.has(`${dev._id}/${lab._id}`),
        };
      }),
    };
  });

  return {
    serverTime: now.toISOString(),
    labs: sortedLabs.map((lab) => ({ ...toLabDto(lab), declared: declared.has(lab._id) })),
    rows,
  };
}

export function toRunDto(run: RunDoc): RunDto {
  return {
    id: run._id,
    labId: run.labId,
    target: run.target,
    status: run.status,
    ...(run.failureStage ? { failureStage: run.failureStage } : {}),
    ...(run.summary ? { summary: run.summary } : {}),
    startedAt: run.startedAt.toISOString(),
    ...(run.finishedAt ? { finishedAt: run.finishedAt.toISOString() } : {}),
    ...(run.durationMs !== undefined && run.durationMs !== null ? { durationMs: run.durationMs } : {}),
    ...(run.checksPassed !== undefined && run.checksPassed !== null ? { checksPassed: run.checksPassed } : {}),
    ...(run.checksTotal !== undefined && run.checksTotal !== null ? { checksTotal: run.checksTotal } : {}),
    ...(run.totalTokens !== undefined && run.totalTokens !== null ? { totalTokens: run.totalTokens } : {}),
  };
}

export function toEventDto(event: EventDoc): EventDto {
  return {
    id: event._id,
    devId: event.devId,
    type: event.type,
    ...(event.labId ? { labId: event.labId } : {}),
    occurredAt: event.occurredAt.toISOString(),
    receivedAt: event.receivedAt.toISOString(),
    late: event.receivedAt.getTime() - event.occurredAt.getTime() > 10 * 60 * 1000,
    payload: event.payload,
  };
}

export interface EventPage {
  items: EventDto[];
  nextCursor: string | null;
}

export function encodeCursor(event: EventDoc): string {
  return Buffer.from(`${event.receivedAt.toISOString()}|${event._id}`).toString("base64url");
}

function decodeCursor(cursor: string): { receivedAt: Date; id: string } | null {
  try {
    const [iso, id] = Buffer.from(cursor, "base64url").toString().split("|");
    const receivedAt = new Date(iso);
    if (!id || Number.isNaN(receivedAt.getTime())) return null;
    return { receivedAt, id };
  } catch {
    return null;
  }
}

export async function listEvents(filter: { devId?: string; type?: string; cursor?: string | null }, limit = 50): Promise<EventPage> {
  const { events } = await getCollections();
  const query: Filter<EventDoc> = {};
  if (filter.devId) query.devId = filter.devId;
  if (filter.type) query.type = filter.type;
  if (filter.cursor) {
    const decoded = decodeCursor(filter.cursor);
    if (!decoded) throw new ApiError("validation", "Invalid cursor", { reason: "cursor" });
    query.$or = [{ receivedAt: { $lt: decoded.receivedAt } }, { receivedAt: decoded.receivedAt, _id: { $lt: decoded.id } }];
  }
  const docs = await events.find(query).sort({ receivedAt: -1, _id: -1 }).limit(limit + 1).toArray();
  const page = docs.slice(0, limit);
  return {
    items: page.map(toEventDto),
    nextCursor: docs.length > limit ? encodeCursor(page[page.length - 1]) : null,
  };
}

export async function getDevDetail(devId: string, now = new Date()): Promise<DevDetailDto> {
  const { devs, labs, runs, helpRequests } = await getCollections();
  const dev = await devs.findOne({ _id: devId });
  if (!dev) {
    throw new ApiError("notFound", "Developer not found");
  }
  const [labDocs, runDocs, helpDocs, eventPage, activeHelp] = await Promise.all([
    labs.find({}).toArray(),
    runs.find({ devId }).sort({ startedAt: -1 }).limit(50).toArray(),
    helpRequests.find({ devId }).sort({ createdAt: -1 }).limit(50).toArray(),
    listEvents({ devId }, 100),
    activeHelpByDev(),
  ]);

  const online = isOnline(dev, now);
  const activeLabs = new Set(helpDocs.filter((h) => ACTIVE_HELP_STATUSES.includes(h.status) && h.labId).map((h) => h.labId));
  const labMap = new Map(labDocs.map((lab) => [lab._id, lab]));
  const labIds = new Set<string>([...(dev.catalogLabIds ?? []), ...Object.keys(dev.progress ?? {})]);
  const progress: LabProgressDto[] = sortLabs([...labIds].map((id) => labMap.get(id) ?? placeholderLab(id, now))).map((lab) => {
    const p = dev.progress?.[lab._id];
    return {
      labId: lab._id,
      lab: toLabDto(lab),
      display: labDisplayState(p, online),
      state: p?.state ?? "notStarted",
      blocked: activeLabs.has(lab._id),
      ...(p?.activeRunId ? { activeRunId: p.activeRunId } : {}),
      runCount: p?.runCount ?? 0,
      solutionRunCount: p?.solutionRunCount ?? 0,
      ...(p?.firstRunAt ? { firstRunAt: p.firstRunAt.toISOString() } : {}),
      ...(p?.lastRunAt ? { lastRunAt: p.lastRunAt.toISOString() } : {}),
      ...(p?.lastRunStatus ? { lastRunStatus: p.lastRunStatus } : {}),
      ...(p?.lastRunTarget ? { lastRunTarget: p.lastRunTarget } : {}),
      ...(p?.completedAt ? { completedAt: p.completedAt.toISOString() } : {}),
      ...(p?.solutionViewedAt ? { solutionViewedAt: p.solutionViewedAt.toISOString() } : {}),
      totalTokens: p?.totalTokens ?? 0,
    };
  });

  const summary = toDevSummary(dev, activeHelp, now);
  return {
    serverTime: now.toISOString(),
    dev: {
      ...summary,
      createdAt: dev.createdAt.toISOString(),
      ...(dev.platform ? { platform: dev.platform } : {}),
      ...(dev.dashboardVersion ? { dashboardVersion: dev.dashboardVersion } : {}),
      ...(dev.archivedAt ? { archivedAt: dev.archivedAt.toISOString() } : {}),
    },
    progress,
    runs: runDocs.map(toRunDto),
    helpRequests: helpDocs.map(toHelpDto),
    events: eventPage.items,
    nextCursor: eventPage.nextCursor,
  };
}

function placeholderLab(id: string, now: Date): LabDoc {
  return { _id: id, number: "", track: "", title: id, level: "", interactive: false, sortOrder: 999, firstSeenAt: now, updatedAt: now };
}

export async function setArchived(devId: string, archived: boolean, now = new Date()): Promise<void> {
  const { devs } = await getCollections();
  const result = await devs.updateOne({ _id: devId }, { $set: { archivedAt: archived ? now : null } });
  if (result.matchedCount === 0) {
    throw new ApiError("notFound", "Developer not found");
  }
}
