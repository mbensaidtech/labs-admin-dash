import { MongoClient, type Db, type Collection, type MongoClientOptions } from "mongodb";
import { readEnv } from "@/lib/env";
import { ensureIndexes } from "@/lib/db/indexes";
import type { DevDoc, EventDoc, HelpRequestDoc, LabDoc, RunDoc } from "@/lib/db/types";

interface Cached {
  uri: string;
  dbName: string;
  client: MongoClient;
  ready: Promise<Db>;
}

// One client per process, reused across serverless invocations (never one connection per request).
const globalForMongo = globalThis as unknown as { __labsAdminMongo?: Cached };

const OPTIONS: MongoClientOptions = {
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5_000,
  connectTimeoutMS: 5_000,
};

export interface Collections {
  devs: Collection<DevDoc>;
  labs: Collection<LabDoc>;
  runs: Collection<RunDoc>;
  helpRequests: Collection<HelpRequestDoc>;
  events: Collection<EventDoc>;
}

export function getClient(): MongoClient {
  return getCached().client;
}

/** The database, with indexes ensured once per process. Throws when the server is unreachable. */
export async function getDb(): Promise<Db> {
  return getCached().ready;
}

export async function getCollections(): Promise<Collections> {
  return collections(await getDb());
}

export function collections(db: Db): Collections {
  return {
    devs: db.collection<DevDoc>("devs"),
    labs: db.collection<LabDoc>("labs"),
    runs: db.collection<RunDoc>("runs"),
    helpRequests: db.collection<HelpRequestDoc>("helpRequests"),
    events: db.collection<EventDoc>("events"),
  };
}

function getCached(): Cached {
  const { mongodbUri, mongodbDb } = readEnv();
  if (!mongodbUri) {
    throw new Error("MONGODB_URI is not configured");
  }

  const cached = globalForMongo.__labsAdminMongo;
  if (cached && cached.uri === mongodbUri && cached.dbName === mongodbDb) {
    return cached;
  }

  if (cached) {
    void cached.client.close().catch(() => undefined);
  }

  const client = new MongoClient(mongodbUri, OPTIONS);
  const ready = client
    .connect()
    .then(async (connected) => {
      const db = connected.db(mongodbDb);
      await ensureIndexes(db);
      return db;
    })
    .catch((error: unknown) => {
      // Let the next call retry instead of caching a failed connection forever.
      if (globalForMongo.__labsAdminMongo?.client === client) {
        globalForMongo.__labsAdminMongo = undefined;
      }
      throw error;
    });

  const entry: Cached = { uri: mongodbUri, dbName: mongodbDb, client, ready };
  globalForMongo.__labsAdminMongo = entry;
  return entry;
}

/** Closes the cached client (tests and scripts). */
export async function closeDb(): Promise<void> {
  const cached = globalForMongo.__labsAdminMongo;
  globalForMongo.__labsAdminMongo = undefined;
  if (cached) {
    await cached.client.close();
  }
}

/** Reachability check for the health endpoint: a ping with a short timeout. */
export async function pingDb(): Promise<boolean> {
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}
