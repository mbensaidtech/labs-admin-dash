import { describe, expect, it } from "vitest";
import { getCollections } from "@/lib/db/client";
import { getDevDetail, getOverview, listEvents } from "@/lib/domain/queries";
import { transactionsAreSupported } from "@/lib/domain/projection";
import { CATALOG, event, registerDev, sendEvents } from "./helpers";

const LAB = "azureopenai-lab01";

async function progressOf(userId: string, labId: string) {
  const { devs } = await getCollections();
  const dev = await devs.findOne({ _id: userId });
  return dev?.progress?.[labId];
}

describe("event ingestion and projection (T5)", () => {
  it("applies catalog + snapshot, ignores a replayed batch and runs in a transaction", async () => {
    const dev = await registerDev();
    const batch = [
      event({ type: "catalog.synced", payload: CATALOG }),
      event({
        type: "progress.snapshot",
        payload: { labs: [{ labId: LAB, state: "inProgress", runCount: 2, lastRunStatus: "failed", lastRunTarget: "start", totalTokens: 120 }] },
      }),
    ];
    const first = await sendEvents(dev, batch);
    expect(first.status).toBe(202);
    expect(await first.json()).toMatchObject({ accepted: 2, ignored: 0 });
    expect(transactionsAreSupported()).toBe(true);

    const detail = await getDevDetail(dev.userId);
    expect(detail.progress.map((p) => p.labId)).toEqual(["azureopenai-lab01", "azureopenai-lab02", "azureopenai-lab03"]);
    expect(detail.progress[0]).toMatchObject({ state: "inProgress", runCount: 2, lastRunStatus: "failed", totalTokens: 120 });
    expect(detail.progress[1]).toMatchObject({ state: "notStarted", runCount: 0 });
    expect(detail.dev.total).toBe(3);

    const replay = await sendEvents(dev, batch);
    expect(await replay.json()).toMatchObject({ accepted: 0, ignored: 2 });
    expect((await progressOf(dev.userId, LAB))?.runCount).toBe(2);
  });

  it("run.started → inProgress with an active run; passed → completed; a later failure keeps completed", async () => {
    const dev = await registerDev();
    await sendEvents(dev, [event({ type: "catalog.synced", payload: CATALOG })]);
    await sendEvents(dev, [event({ type: "run.started", labId: LAB, payload: { runId: "run-1", target: "start" } })]);
    let p = await progressOf(dev.userId, LAB);
    expect(p).toMatchObject({ state: "inProgress", activeRunId: "run-1" });
    let overview = await getOverview();
    expect(overview.devs[0]).toMatchObject({ state: "running", currentLab: LAB });
    expect(overview.counters.running).toBe(1);

    await sendEvents(dev, [
      event({ type: "run.finished", labId: LAB, payload: { runId: "run-1", target: "start", status: "passed", durationMs: 4000, checks: [{ id: "a", passed: true }], totalTokens: 300 } }),
    ]);
    p = await progressOf(dev.userId, LAB);
    expect(p).toMatchObject({ state: "completed", activeRunId: null, runCount: 1, totalTokens: 300, lastRunStatus: "passed" });
    expect(p?.completedAt).toBeInstanceOf(Date);
    const completedAt = p!.completedAt!;

    await sendEvents(dev, [
      event({ type: "run.started", labId: LAB, payload: { runId: "run-2", target: "start" } }),
      event({ type: "run.finished", labId: LAB, payload: { runId: "run-2", target: "start", status: "failed", failureStage: "checks", durationMs: 1000 } }),
    ]);
    p = await progressOf(dev.userId, LAB);
    expect(p).toMatchObject({ state: "completed", runCount: 2, lastRunStatus: "failed", activeRunId: null });
    expect(p?.completedAt?.getTime()).toBe(completedAt.getTime());

    overview = await getOverview();
    expect(overview.devs[0]).toMatchObject({ state: "online", completed: 1, total: 3 });
    expect(overview.counters.completedLabs).toBe(1);
  });

  it("run.finished before run.started leaves one run document and no dangling active run", async () => {
    const dev = await registerDev();
    const finished = event({ type: "run.finished", labId: LAB, payload: { runId: "run-x", target: "start", status: "failed", failureStage: "build", durationMs: 2000 } });
    const started = event({ type: "run.started", labId: LAB, payload: { runId: "run-x", target: "start" } });
    await sendEvents(dev, [finished]);
    await sendEvents(dev, [started]);
    const { runs } = await getCollections();
    const docs = await runs.find({ devId: dev.userId }).toArray();
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ _id: "run-x", status: "failed", failureStage: "build", target: "start" });
    const p = await progressOf(dev.userId, LAB);
    expect(p?.activeRunId).toBeNull();
    expect(p).toMatchObject({ state: "inProgress", runCount: 1 });
  });

  it("a solution run counts separately and never completes the lab", async () => {
    const dev = await registerDev();
    await sendEvents(dev, [
      event({ type: "run.started", labId: LAB, payload: { runId: "sol-1", target: "solution" } }),
      event({ type: "run.finished", labId: LAB, payload: { runId: "sol-1", target: "solution", status: "passed", totalTokens: 999 } }),
    ]);
    const p = await progressOf(dev.userId, LAB);
    expect(p).toMatchObject({ state: "notStarted", runCount: 0, solutionRunCount: 1, totalTokens: 0, lastRunStatus: "passed", lastRunTarget: "solution" });
    expect(p?.completedAt ?? null).toBeNull();
  });

  it("the snapshot is authoritative for counters but completion is sticky", async () => {
    const dev = await registerDev();
    await sendEvents(dev, [
      event({ type: "run.finished", labId: LAB, payload: { runId: "r1", target: "start", status: "passed" } }),
      event({ type: "solution.viewed", labId: LAB }),
    ]);
    await sendEvents(dev, [
      event({ type: "progress.snapshot", payload: { labs: [{ labId: LAB, state: "inProgress", runCount: 5, totalTokens: 10 }] } }),
    ]);
    const p = await progressOf(dev.userId, LAB);
    expect(p).toMatchObject({ state: "completed", runCount: 5, totalTokens: 10 });
    expect(p?.solutionViewedAt).toBeInstanceOf(Date);
    expect(p?.completedAt).toBeInstanceOf(Date);
  });

  it("stores unknown types, creates unknown labs and shows both in the feed", async () => {
    const dev = await registerDev();
    const response = await sendEvents(dev, [
      event({ type: "coffee.brewed", labId: "mystery-lab", payload: { cups: 2 } }),
      event({ type: "lab.opened", labId: "mystery-lab" }),
    ]);
    expect(await response.json()).toMatchObject({ accepted: 2, ignored: 0 });
    const { labs } = await getCollections();
    expect(await labs.findOne({ _id: "mystery-lab" })).toMatchObject({ title: "mystery-lab", sortOrder: 999 });
    const feed = await listEvents({ devId: dev.userId });
    expect(feed.items.map((e) => e.type)).toEqual(["lab.opened", "coffee.brewed"]);
    expect(feed.items[1].payload).toEqual({ cups: 2 });
    const detail = await getDevDetail(dev.userId);
    expect(detail.dev.lastActivityType).toBe("lab.opened");
  });

  it("heartbeat updates lastSeenAt only and clears dangling runs when activeRunId is null", async () => {
    const dev = await registerDev();
    await sendEvents(dev, [event({ type: "run.started", labId: LAB, payload: { runId: "r", target: "start" } })]);
    const { devs } = await getCollections();
    const before = (await devs.findOne({ _id: dev.userId }))!;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await sendEvents(dev, [event({ type: "heartbeat", payload: { browserConnected: true, activeRunId: null } })]);
    const after = (await devs.findOne({ _id: dev.userId }))!;
    expect(after.lastSeenAt.getTime()).toBeGreaterThan(before.lastSeenAt.getTime());
    expect(after.lastActivityAt.getTime()).toBe(before.lastActivityAt.getTime());
    expect(after.progress[LAB].activeRunId).toBeNull();
  });

  it("rejects a batch when one known-type event has a bad payload, applying nothing", async () => {
    const dev = await registerDev();
    const response = await sendEvents(dev, [
      event({ type: "lab.opened", labId: LAB }),
      event({ type: "run.started", labId: LAB, payload: { runId: "r", target: "sideways" } }),
    ]);
    expect(response.status).toBe(400);
    expect((await response.json()).details.index).toBe(1);
    const { events } = await getCollections();
    expect(await events.countDocuments({ devId: dev.userId })).toBe(0);
  });

  it("clamps occurredAt to the server clock window and flags late events", async () => {
    const dev = await registerDev();
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
    await sendEvents(dev, [event({ type: "lab.opened", labId: LAB, occurredAt: threeDaysAgo })]);
    const feed = await listEvents({ devId: dev.userId });
    expect(feed.items[0].late).toBe(true);
    expect(Date.now() - Date.parse(feed.items[0].occurredAt)).toBeLessThanOrEqual(24 * 3600 * 1000 + 5000);
  });

  it("reporting un-archives a developer", async () => {
    const dev = await registerDev();
    const { devs } = await getCollections();
    await devs.updateOne({ _id: dev.userId }, { $set: { archivedAt: new Date() } });
    expect((await getOverview()).devs).toHaveLength(0);
    await sendEvents(dev, [event({ type: "heartbeat" })]);
    expect((await getOverview()).devs).toHaveLength(1);
  });
});
