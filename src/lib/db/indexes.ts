import type { Db, IndexDescription } from "mongodb";

/** Every index of the Data Model; idempotent (createIndexes skips existing ones). */
export const INDEXES: Record<string, IndexDescription[]> = {
  devs: [
    { key: { archivedAt: 1, lastActivityAt: -1 }, name: "overview" },
    { key: { catalogLabIds: 1 }, name: "catalogLabIds" },
    { key: { workshopId: 1, archivedAt: 1, lastActivityAt: -1 }, name: "workshopOverview" },
  ],
  runs: [
    { key: { devId: 1, startedAt: -1 }, name: "devRuns" },
    { key: { workshopId: 1, startedAt: -1 }, name: "workshopRuns" },
  ],
  helpRequests: [
    { key: { status: 1, createdAt: 1 }, name: "queue" },
    { key: { workshopId: 1, status: 1, createdAt: 1 }, name: "workshopQueue" },
    { key: { devId: 1, createdAt: -1 }, name: "devHelp" },
    {
      key: { devId: 1 },
      name: "oneActivePerDev",
      unique: true,
      partialFilterExpression: { status: { $in: ["open", "acknowledged"] } },
    },
  ],
  events: [
    { key: { devId: 1, receivedAt: -1 }, name: "devFeed" },
    { key: { receivedAt: -1 }, name: "feed" },
    { key: { type: 1, receivedAt: -1 }, name: "typeFeed" },
    { key: { workshopId: 1, receivedAt: -1 }, name: "workshopFeed" },
  ],
  labs: [],
  workshops: [
    { key: { code: 1 }, name: "code", unique: true },
    { key: { status: 1, createdAt: -1 }, name: "list" },
  ],
};

export async function ensureIndexes(db: Db): Promise<void> {
  for (const [name, indexes] of Object.entries(INDEXES)) {
    // Creating the collection explicitly makes it exist even before the first document.
    const existing = await db.listCollections({ name }, { nameOnly: true }).toArray();
    if (existing.length === 0) {
      await db.createCollection(name).catch(() => undefined);
    }
    if (indexes.length > 0) {
      await db.collection(name).createIndexes(indexes);
    }
  }
}

/** Names of the expected indexes that are missing (startup check, logged only). */
export async function missingIndexes(db: Db): Promise<string[]> {
  const missing: string[] = [];
  for (const [name, indexes] of Object.entries(INDEXES)) {
    const present = new Set((await db.collection(name).indexes()).map((index) => index.name));
    for (const index of indexes) {
      if (!present.has(index.name)) {
        missing.push(`${name}.${index.name}`);
      }
    }
  }
  return missing;
}
