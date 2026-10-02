import type { AnyBulkWriteOperation, ClientSession, Document, MongoServerError } from "mongodb";
import { ApiError } from "@/lib/api/errors";
import {
  catalogSyncedPayload,
  heartbeatPayload,
  progressSnapshotPayload,
  runFinishedPayload,
  runStartedPayload,
  settingsChangedPayload,
  type EventInput,
} from "@/lib/api/schemas";
import { collections, getClient, getDb, type Collections } from "@/lib/db/client";
import type { DevDoc, EventDoc, LabDoc, LabProgress, RunStatus } from "@/lib/db/types";
import { clampOccurredAt } from "@/lib/domain/time";

export interface ApplyResult {
  accepted: number;
  ignored: number;
}

interface PreparedEvent {
  index: number;
  doc: EventDoc;
  apply: (ctx: ApplyContext) => Promise<void>;
}

interface ApplyContext {
  c: Collections;
  session?: ClientSession;
  devId: string;
  now: Date;
}

const EMPTY_PROGRESS = (now: Date): LabProgress => ({
  state: "notStarted",
  activeRunId: null,
  runCount: 0,
  solutionRunCount: 0,
  totalTokens: 0,
  updatedAt: now,
});

const TERMINAL_RUN: RunStatus[] = ["passed", "failed", "cancelled", "timedOut"];

// Whether the server accepts multi-document transactions (replica set). Learned on the first batch.
let transactionsSupported: boolean | undefined;

export function transactionsAreSupported(): boolean | undefined {
  return transactionsSupported;
}

/**
 * Validates a whole batch (one bad event rejects the batch with its index), then applies it in order
 * inside one transaction when the deployment supports them. Duplicate eventIds are counted as ignored.
 */
export async function applyEventBatch(dev: DevDoc, events: EventInput[], now = new Date()): Promise<ApplyResult> {
  const prepared = events.map((event, index) => prepareEvent(dev._id, event, index, now));

  const client = getClient();
  const db = await getDb();
  const c = collections(db);

  const run = async (session?: ClientSession): Promise<ApplyResult> => {
    const ids = prepared.map((p) => p.doc._id);
    const existing = new Set(
      (await c.events.find({ _id: { $in: ids } }, { projection: { _id: 1 }, session }).toArray()).map((e) => e._id),
    );
    // A batch may repeat an id too: the first occurrence wins.
    const seen = new Set<string>();
    let accepted = 0;
    let ignored = 0;
    for (const p of prepared) {
      if (existing.has(p.doc._id) || seen.has(p.doc._id)) {
        ignored += 1;
        continue;
      }
      seen.add(p.doc._id);
      await c.events.insertOne(p.doc, { session });
      await p.apply({ c, session, devId: dev._id, now });
      accepted += 1;
    }
    return { accepted, ignored };
  };

  if (transactionsSupported !== false) {
    const session = client.startSession();
    try {
      let result: ApplyResult = { accepted: 0, ignored: 0 };
      await session.withTransaction(async () => {
        result = await run(session);
      });
      transactionsSupported = true;
      return result;
    } catch (error) {
      if (isStandaloneError(error)) {
        transactionsSupported = false;
        console.warn("MongoDB transactions are not available (standalone server): batches are applied without a transaction.");
      } else {
        throw error;
      }
    } finally {
      await session.endSession();
    }
  }

  return run(undefined);
}

function isStandaloneError(error: unknown): boolean {
  const e = error as Partial<MongoServerError> & { code?: number; message?: string };
  return e?.code === 20 || /Transaction numbers are only allowed|replica set/i.test(e?.message ?? "");
}

function prepareEvent(devId: string, event: EventInput, index: number, now: Date): PreparedEvent {
  const occurredAt = clampOccurredAt(new Date(event.occurredAt), now);
  const payloadBytes = Buffer.byteLength(JSON.stringify(event.payload ?? null));
  if (payloadBytes > 32 * 1024) {
    throw new ApiError("validation", `Event ${index} payload exceeds 32 KB`, { index, reason: "payloadTooLarge" });
  }

  // Events of one batch get receivedAt offset by their index (ms) so the feed keeps the batch order.
  const doc: EventDoc = {
    _id: event.eventId,
    devId,
    type: event.type,
    ...(event.labId ? { labId: event.labId } : {}),
    occurredAt,
    receivedAt: new Date(now.getTime() + index),
    payload: event.payload ?? {},
  };

  const requireLab = (): string => {
    if (!event.labId) {
      throw new ApiError("validation", `Event ${index} (${event.type}) requires a labId`, { index, reason: "labIdRequired" });
    }
    return event.labId;
  };

  const parse = <T>(schema: { safeParse: (value: unknown) => { success: boolean; data?: T; error?: { issues: { path: PropertyKey[]; message: string }[] } } }): T => {
    const result = schema.safeParse(event.payload ?? {});
    if (!result.success || result.data === undefined) {
      const issue = result.error?.issues[0];
      throw new ApiError("validation", `Event ${index} (${event.type}) has an invalid payload`, {
        index,
        reason: issue ? `payload.${issue.path.join(".")}: ${issue.message}` : "invalidPayload",
      });
    }
    return result.data;
  };

  switch (event.type) {
    case "catalog.synced": {
      const payload = parse<ReturnType<typeof catalogSyncedPayload.parse>>(catalogSyncedPayload);
      return { index, doc, apply: (ctx) => applyCatalogSynced(ctx, payload, occurredAt) };
    }
    case "progress.snapshot": {
      const payload = parse<ReturnType<typeof progressSnapshotPayload.parse>>(progressSnapshotPayload);
      return { index, doc, apply: (ctx) => applyProgressSnapshot(ctx, payload) };
    }
    case "run.started": {
      const labId = requireLab();
      const payload = parse<ReturnType<typeof runStartedPayload.parse>>(runStartedPayload);
      return { index, doc, apply: (ctx) => applyRunStarted(ctx, labId, payload, occurredAt) };
    }
    case "run.finished": {
      const labId = requireLab();
      const payload = parse<ReturnType<typeof runFinishedPayload.parse>>(runFinishedPayload);
      return { index, doc, apply: (ctx) => applyRunFinished(ctx, labId, payload, occurredAt) };
    }
    case "solution.viewed": {
      const labId = requireLab();
      return { index, doc, apply: (ctx) => applySolutionViewed(ctx, labId, occurredAt) };
    }
    case "lab.opened": {
      const labId = requireLab();
      return { index, doc, apply: (ctx) => applyActivity(ctx, "lab.opened", labId) };
    }
    case "heartbeat": {
      const payload = parse<ReturnType<typeof heartbeatPayload.parse>>(heartbeatPayload);
      return { index, doc, apply: (ctx) => applyHeartbeat(ctx, payload) };
    }
    case "settings.changed": {
      parse(settingsChangedPayload);
      return { index, doc, apply: (ctx) => ensureLab(ctx, event.labId) };
    }
    default:
      // Unknown type: stored, counted, shown in the feed as "Other event"; the lab is created if named.
      return { index, doc, apply: (ctx) => ensureLab(ctx, event.labId) };
  }
}

/** Business Rule 12: an event for an unknown lab creates a minimal lab document. */
async function ensureLab(ctx: ApplyContext, labId: string | undefined): Promise<void> {
  if (!labId) return;
  await ctx.c.labs.updateOne(
    { _id: labId },
    {
      $setOnInsert: {
        number: "",
        track: "",
        title: labId,
        level: "",
        interactive: false,
        sortOrder: 999,
        firstSeenAt: ctx.now,
        updatedAt: ctx.now,
      },
    },
    { upsert: true, session: ctx.session },
  );
}

function progressPath(labId: string, field: keyof LabProgress | ""): string {
  return field ? `progress.${labId}.${field}` : `progress.${labId}`;
}

async function applyCatalogSynced(
  ctx: ApplyContext,
  payload: ReturnType<typeof catalogSyncedPayload.parse>,
  occurredAt: Date,
): Promise<void> {
  if (payload.labs.length > 0) {
    const ops: AnyBulkWriteOperation<LabDoc>[] = payload.labs.map((lab) => ({
      updateOne: {
        filter: { _id: lab.id },
        update: {
          $set: {
            number: lab.number,
            track: lab.track,
            title: lab.title || lab.id,
            level: lab.level,
            interactive: lab.interactive,
            sortOrder: lab.sortOrder,
            updatedAt: ctx.now,
          },
          $setOnInsert: { firstSeenAt: ctx.now },
        },
        upsert: true,
      },
    }));
    await ctx.c.labs.bulkWrite(ops, { session: ctx.session, ordered: false });
  }

  const set: Document = { catalogLabIds: payload.labs.map((lab) => lab.id), lastSeenAt: ctx.now };
  for (const lab of payload.labs) {
    set[progressPath(lab.id, "")] = { $ifNull: [`$${progressPath(lab.id, "")}`, EMPTY_PROGRESS(occurredAt)] };
  }
  await ctx.c.devs.updateOne({ _id: ctx.devId }, [{ $set: set }], { session: ctx.session });
}

/** Business Rule 8: the snapshot overwrites counters, completion is sticky, unknown fields are kept. */
async function applyProgressSnapshot(
  ctx: ApplyContext,
  payload: ReturnType<typeof progressSnapshotPayload.parse>,
): Promise<void> {
  if (payload.labs.length === 0) return;

  for (const lab of payload.labs) {
    await ensureLab(ctx, lab.labId);
  }

  const set: Document = { lastSeenAt: ctx.now };
  for (const lab of payload.labs) {
    const p = (field: keyof LabProgress) => `$${progressPath(lab.labId, field)}`;
    const completedEitherSide = {
      $or: [{ $eq: [p("state"), "completed"] }, { $eq: [lab.state, "completed"] }],
    };
    const snapshotCompletedAt = lab.completedAt ? new Date(lab.completedAt) : null;
    const merged: Document = {
      state: { $cond: [completedEitherSide, "completed", lab.state] },
      runCount: lab.runCount,
      solutionRunCount: lab.solutionRunCount,
      totalTokens: lab.totalTokens,
      lastRunAt: lab.lastRunAt ? new Date(lab.lastRunAt) : null,
      lastRunStatus: lab.lastRunStatus ?? null,
      lastRunTarget: lab.lastRunTarget ?? null,
      firstRunAt: lab.firstRunAt ? new Date(lab.firstRunAt) : null,
      completedAt: snapshotCompletedAt
        ? { $ifNull: [p("completedAt"), snapshotCompletedAt] }
        : { $ifNull: [p("completedAt"), null] },
      activeRunId:
        lab.activeRunId === undefined ? { $ifNull: [p("activeRunId"), null] } : lab.activeRunId,
      solutionViewedAt:
        lab.solutionViewedAt === undefined
          ? { $ifNull: [p("solutionViewedAt"), null] }
          : lab.solutionViewedAt
            ? new Date(lab.solutionViewedAt)
            : null,
      updatedAt: ctx.now,
    };
    set[progressPath(lab.labId, "")] = merged;
  }
  await ctx.c.devs.updateOne({ _id: ctx.devId }, [{ $set: set }], { session: ctx.session });
}

async function applyRunStarted(
  ctx: ApplyContext,
  labId: string,
  payload: ReturnType<typeof runStartedPayload.parse>,
  occurredAt: Date,
): Promise<void> {
  await ensureLab(ctx, labId);

  // The run document: created now, or already there if run.finished arrived first (status kept).
  await ctx.c.runs.updateOne(
    { _id: payload.runId },
    [
      {
        $set: {
          devId: { $ifNull: ["$devId", ctx.devId] },
          labId: { $ifNull: ["$labId", labId] },
          target: { $ifNull: ["$target", payload.target] },
          startedAt: { $ifNull: ["$startedAt", occurredAt] },
          status: { $cond: [{ $in: [{ $ifNull: ["$status", "running"] }, TERMINAL_RUN] }, "$status", "running"] },
        },
      },
    ],
    { upsert: true, session: ctx.session },
  );

  const p = (field: keyof LabProgress) => `$${progressPath(labId, field)}`;
  const finishedBefore = await ctx.c.runs.findOne(
    { _id: payload.runId, status: { $in: TERMINAL_RUN } },
    { projection: { _id: 1 }, session: ctx.session },
  );

  await ctx.c.devs.updateOne({ _id: ctx.devId }, [
    {
      $set: {
        [progressPath(labId, "state")]: {
          $cond: [
            { $eq: [p("state"), "completed"] },
            "completed",
            payload.target === "start" ? "inProgress" : { $ifNull: [p("state"), "notStarted"] },
          ],
        },
        // A run.finished that arrived earlier (reordered batch) already closed this run: never leave it dangling.
        [progressPath(labId, "activeRunId")]: finishedBefore ? null : payload.runId,
        [progressPath(labId, "runCount")]: { $ifNull: [p("runCount"), 0] },
        [progressPath(labId, "solutionRunCount")]: { $ifNull: [p("solutionRunCount"), 0] },
        [progressPath(labId, "totalTokens")]: { $ifNull: [p("totalTokens"), 0] },
        [progressPath(labId, "updatedAt")]: ctx.now,
        lastSeenAt: ctx.now,
        lastActivityAt: ctx.now,
        lastActivityType: "run.started",
        lastActivityLab: labId,
      },
    },
  ], { session: ctx.session });
}

async function applyRunFinished(
  ctx: ApplyContext,
  labId: string,
  payload: ReturnType<typeof runFinishedPayload.parse>,
  occurredAt: Date,
): Promise<void> {
  await ensureLab(ctx, labId);

  const checks = payload.checks ?? [];
  const startedAt = new Date(occurredAt.getTime() - (payload.durationMs ?? 0));
  await ctx.c.runs.updateOne(
    { _id: payload.runId },
    [
      {
        $set: {
          devId: { $ifNull: ["$devId", ctx.devId] },
          labId: { $ifNull: ["$labId", labId] },
          target: payload.target,
          status: payload.status,
          failureStage: payload.failureStage ?? null,
          summary: payload.summary ?? null,
          startedAt: { $ifNull: ["$startedAt", startedAt] },
          finishedAt: occurredAt,
          durationMs: payload.durationMs ?? null,
          checksPassed: payload.checks ? checks.filter((check) => check.passed).length : null,
          checksTotal: payload.checks ? checks.length : null,
          totalTokens: payload.totalTokens ?? null,
        },
      },
    ],
    { upsert: true, session: ctx.session },
  );

  const isStart = payload.target === "start";
  const passed = isStart && payload.status === "passed";
  const p = (field: keyof LabProgress) => `$${progressPath(labId, field)}`;
  const isLatest = {
    $or: [{ $eq: [{ $ifNull: [p("lastRunAt"), null] }, null] }, { $lte: [p("lastRunAt"), occurredAt] }],
  };

  await ctx.c.devs.updateOne({ _id: ctx.devId }, [
    {
      $set: {
        [progressPath(labId, "state")]: {
          $cond: [
            { $or: [{ $eq: [p("state"), "completed"] }, passed] },
            "completed",
            isStart ? "inProgress" : { $ifNull: [p("state"), "notStarted"] },
          ],
        },
        [progressPath(labId, "activeRunId")]: null,
        [progressPath(labId, "runCount")]: { $add: [{ $ifNull: [p("runCount"), 0] }, isStart ? 1 : 0] },
        [progressPath(labId, "solutionRunCount")]: { $add: [{ $ifNull: [p("solutionRunCount"), 0] }, isStart ? 0 : 1] },
        [progressPath(labId, "totalTokens")]: {
          $add: [{ $ifNull: [p("totalTokens"), 0] }, isStart ? (payload.totalTokens ?? 0) : 0],
        },
        [progressPath(labId, "firstRunAt")]: { $min: [{ $ifNull: [p("firstRunAt"), occurredAt] }, occurredAt] },
        [progressPath(labId, "lastRunAt")]: { $cond: [isLatest, occurredAt, p("lastRunAt")] },
        [progressPath(labId, "lastRunStatus")]: { $cond: [isLatest, payload.status, p("lastRunStatus")] },
        [progressPath(labId, "lastRunTarget")]: { $cond: [isLatest, payload.target, p("lastRunTarget")] },
        [progressPath(labId, "completedAt")]: passed
          ? { $min: [{ $ifNull: [p("completedAt"), occurredAt] }, occurredAt] }
          : { $ifNull: [p("completedAt"), null] },
        [progressPath(labId, "updatedAt")]: ctx.now,
        lastSeenAt: ctx.now,
        lastActivityAt: ctx.now,
        lastActivityType: "run.finished",
        lastActivityLab: labId,
      },
    },
  ], { session: ctx.session });
}

async function applySolutionViewed(ctx: ApplyContext, labId: string, occurredAt: Date): Promise<void> {
  await ensureLab(ctx, labId);
  const p = (field: keyof LabProgress) => `$${progressPath(labId, field)}`;
  await ctx.c.devs.updateOne({ _id: ctx.devId }, [
    {
      $set: {
        [progressPath(labId, "state")]: { $ifNull: [p("state"), "notStarted"] },
        [progressPath(labId, "runCount")]: { $ifNull: [p("runCount"), 0] },
        [progressPath(labId, "solutionRunCount")]: { $ifNull: [p("solutionRunCount"), 0] },
        [progressPath(labId, "totalTokens")]: { $ifNull: [p("totalTokens"), 0] },
        [progressPath(labId, "solutionViewedAt")]: { $ifNull: [p("solutionViewedAt"), occurredAt] },
        [progressPath(labId, "updatedAt")]: ctx.now,
        lastSeenAt: ctx.now,
        lastActivityAt: ctx.now,
        lastActivityType: "solution.viewed",
        lastActivityLab: labId,
      },
    },
  ], { session: ctx.session });
}

async function applyActivity(ctx: ApplyContext, type: string, labId: string): Promise<void> {
  await ensureLab(ctx, labId);
  await ctx.c.devs.updateOne(
    { _id: ctx.devId },
    { $set: { lastSeenAt: ctx.now, lastActivityAt: ctx.now, lastActivityType: type, lastActivityLab: labId } },
    { session: ctx.session },
  );
}

/** Heartbeat: lastSeenAt only; `activeRunId: null` clears every dangling active run. */
async function applyHeartbeat(ctx: ApplyContext, payload: ReturnType<typeof heartbeatPayload.parse>): Promise<void> {
  if (payload.activeRunId === null) {
    await ctx.c.devs.updateOne({ _id: ctx.devId }, [
      {
        $set: {
          lastSeenAt: ctx.now,
          progress: {
            $arrayToObject: {
              $map: {
                input: { $objectToArray: { $ifNull: ["$progress", {}] } },
                as: "p",
                in: { k: "$$p.k", v: { $mergeObjects: ["$$p.v", { activeRunId: null }] } },
              },
            },
          },
        },
      },
    ], { session: ctx.session });
    return;
  }
  await ctx.c.devs.updateOne({ _id: ctx.devId }, { $set: { lastSeenAt: ctx.now } }, { session: ctx.session });
}
