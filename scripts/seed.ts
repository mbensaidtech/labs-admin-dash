/**
 * Seeds a DEVELOPMENT database with 3 developers, 10 labs, a few runs and one open help request.
 * Refuses to run unless MONGODB_DB is "labs-admin" or ends with "-dev" (never a production database).
 */
import { randomUUID } from "node:crypto";
import "dotenv/config";
import { closeDb, getCollections } from "../src/lib/db/client";
import { hashToken } from "../src/lib/api/auth";
import type { DevDoc, LabDoc, LabProgress, WorkshopDoc } from "../src/lib/db/types";
import { generateWorkshopCode } from "../src/lib/domain/workshopCode";

const dbName = process.env.MONGODB_DB || "labs-admin";
if (!(dbName === "labs-admin" || dbName.endsWith("-dev"))) {
  console.error(`Refusing to seed database "${dbName}": only "labs-admin" or a name ending in "-dev" is allowed.`);
  process.exit(1);
}

const LABS: Omit<LabDoc, "firstSeenAt" | "updatedAt">[] = [
  ["azureopenai-lab01", "01", "First Basic AI Agent", "Beginner"],
  ["azureopenai-lab02", "02", "AI Agent with Structured Output", "Beginner"],
  ["azureopenai-lab03", "03", "AI Agent with Function Tools", "Intermediate"],
  ["azureopenai-lab04", "04", "AI Agent with MCP Client", "Intermediate"],
  ["azureopenai-lab05", "05", "AI Agent with Threads", "Intermediate"],
  ["azureopenai-lab06-server", "06a", "A2A Server", "Advanced"],
  ["azureopenai-lab06-client", "06b", "A2A Client", "Advanced"],
  ["azureopenai-lab07", "07", "Agentic RAG with Vector Store", "Advanced"],
  ["azureopenai-lab08", "08", "Data Format Comparison", "Intermediate"],
  ["azureopenai-lab09", "09", "Function Tools with Human Approval", "Intermediate"],
].map(([id, number, title, level], index) => ({ _id: id, number, track: "Azure OpenAI", title, level, interactive: id === "azureopenai-lab09", sortOrder: index + 1 }));

function progress(state: LabProgress["state"], runs: number, lastRunStatus?: LabProgress["lastRunStatus"], minutesAgo = 30): LabProgress {
  const at = new Date(Date.now() - minutesAgo * 60_000);
  return {
    state,
    activeRunId: null,
    runCount: runs,
    solutionRunCount: 0,
    totalTokens: runs * 420,
    updatedAt: at,
    ...(runs > 0 ? { firstRunAt: at, lastRunAt: at, lastRunStatus, lastRunTarget: "start" as const } : {}),
    ...(state === "completed" ? { completedAt: at } : {}),
  };
}

async function main() {
  const c = await getCollections();
  const now = new Date();
  await c.labs.bulkWrite(LABS.map((lab) => ({ updateOne: { filter: { _id: lab._id }, update: { $set: { ...lab, updatedAt: now }, $setOnInsert: { firstSeenAt: now } }, upsert: true } })));

  // Two sample workshops (codes generated once, kept on later seeds): alice and bob in the first, chloe in the second.
  const SEED_WORKSHOPS: Pick<WorkshopDoc, "_id" | "name">[] = [
    { _id: "seed-workshop-paris", name: "Paris — sample session" },
    { _id: "seed-workshop-remote", name: "Remote — sample session" },
  ];
  for (const workshop of SEED_WORKSHOPS) {
    await c.workshops.updateOne(
      { _id: workshop._id },
      { $set: { name: workshop.name, status: "active", updatedAt: now }, $setOnInsert: { code: generateWorkshopCode(), createdAt: now, closedAt: null } },
      { upsert: true },
    );
  }
  const [paris, remote] = SEED_WORKSHOPS.map((workshop) => workshop._id);

  const labIds = LABS.map((lab) => lab._id);
  const devs: DevDoc[] = [
    {
      _id: randomUUID(), username: "alice", tokenHash: hashToken("seed-token-alice"), platform: "macOS", dashboardVersion: "1.0.0",
      createdAt: new Date(now.getTime() - 3 * 3600_000), lastSeenAt: now, lastActivityAt: new Date(now.getTime() - 2 * 60_000), lastActivityType: "run.finished", lastActivityLab: "azureopenai-lab03",
      workshopId: paris, archivedAt: null, catalogLabIds: labIds,
      progress: { "azureopenai-lab01": progress("completed", 1, "passed", 150), "azureopenai-lab02": progress("completed", 2, "passed", 90), "azureopenai-lab03": progress("inProgress", 3, "failed", 2) },
    },
    {
      _id: randomUUID(), username: "bob", tokenHash: hashToken("seed-token-bob"), platform: "Windows", dashboardVersion: "1.0.0",
      createdAt: new Date(now.getTime() - 2 * 3600_000), lastSeenAt: new Date(now.getTime() - 60_000), lastActivityAt: new Date(now.getTime() - 60_000), lastActivityType: "run.started", lastActivityLab: "azureopenai-lab02",
      workshopId: paris, archivedAt: null, catalogLabIds: labIds,
      progress: { "azureopenai-lab01": progress("completed", 1, "passed", 100), "azureopenai-lab02": { ...progress("inProgress", 1, "failed", 1), activeRunId: "seed-run-bob" } },
    },
    {
      _id: randomUUID(), username: "chloe", tokenHash: hashToken("seed-token-chloe"), platform: "Linux", dashboardVersion: "1.0.0",
      createdAt: new Date(now.getTime() - 26 * 3600_000), lastSeenAt: new Date(now.getTime() - 50 * 60_000), lastActivityAt: new Date(now.getTime() - 50 * 60_000), lastActivityType: "lab.opened", lastActivityLab: "azureopenai-lab01",
      workshopId: remote, archivedAt: null, catalogLabIds: labIds, progress: { "azureopenai-lab01": progress("inProgress", 1, "failed", 50) },
    },
  ];
  await c.devs.deleteMany({ username: { $in: devs.map((dev) => dev.username) } });
  await c.devs.insertMany(devs);

  await c.runs.insertMany([
    { _id: "seed-run-a1", devId: devs[0]._id, workshopId: paris, labId: "azureopenai-lab01", target: "start", status: "passed", startedAt: new Date(now.getTime() - 151 * 60_000), finishedAt: new Date(now.getTime() - 150 * 60_000), durationMs: 42_000, checksPassed: 7, checksTotal: 7, totalTokens: 420 },
    { _id: "seed-run-a3", devId: devs[0]._id, workshopId: paris, labId: "azureopenai-lab03", target: "start", status: "failed", failureStage: "checks", summary: "2 of 5 check(s) failed", startedAt: new Date(now.getTime() - 3 * 60_000), finishedAt: new Date(now.getTime() - 2 * 60_000), durationMs: 35_000, checksPassed: 3, checksTotal: 5, totalTokens: 380 },
    { _id: "seed-run-bob", devId: devs[1]._id, workshopId: paris, labId: "azureopenai-lab02", target: "start", status: "running", startedAt: new Date(now.getTime() - 60_000) },
  ]);

  await c.helpRequests.deleteMany({ devId: { $in: devs.map((dev) => dev._id) } });
  await c.helpRequests.insertOne({ _id: randomUUID(), devId: devs[0]._id, workshopId: paris, labId: "azureopenai-lab03", message: "The tool is never called, the agent answers from memory.", status: "open", createdAt: new Date(now.getTime() - 4 * 60_000) });

  await c.events.insertMany([
    { _id: randomUUID(), devId: devs[0]._id, workshopId: paris, type: "run.finished", labId: "azureopenai-lab03", occurredAt: new Date(now.getTime() - 2 * 60_000), receivedAt: new Date(now.getTime() - 2 * 60_000), payload: { runId: "seed-run-a3", status: "failed" } },
    { _id: randomUUID(), devId: devs[0]._id, workshopId: paris, type: "help.requested", labId: "azureopenai-lab03", occurredAt: new Date(now.getTime() - 4 * 60_000), receivedAt: new Date(now.getTime() - 4 * 60_000), payload: {} },
    { _id: randomUUID(), devId: devs[1]._id, workshopId: paris, type: "run.started", labId: "azureopenai-lab02", occurredAt: new Date(now.getTime() - 60_000), receivedAt: new Date(now.getTime() - 60_000), payload: { runId: "seed-run-bob", target: "start" } },
  ]);

  console.log(`Seeded database "${dbName}": 2 workshops, ${devs.length} devs, ${LABS.length} labs, 3 runs, 1 open help request.`);
  await closeDb();
}

main().catch(async (error) => {
  console.error(error);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
