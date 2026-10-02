/** Explicit run of the legacy WORKSHOP_KEY → "Default workshop" migration (the app also runs it at startup). */
import "dotenv/config";
import { MongoClient } from "mongodb";
import { ensureIndexes } from "../src/lib/db/indexes";
import { migrateLegacyWorkshop } from "../src/lib/db/legacyWorkshop";
import { readEnv } from "../src/lib/env";

async function main() {
  const { mongodbUri, mongodbDb, workshopKey } = readEnv();
  if (!workshopKey.trim()) {
    console.log("WORKSHOP_KEY is not set: nothing to migrate.");
    return;
  }
  // A plain client on purpose: the app's cached client would run the migration itself on connect.
  const client = await new MongoClient(mongodbUri).connect();
  try {
    const db = client.db(mongodbDb);
    await ensureIndexes(db);
    const result = await migrateLegacyWorkshop(db, workshopKey);
    const total = Object.values(result.backfilled).reduce((sum, n) => sum + n, 0);
    if (!result.created && total === 0) {
      console.log(`Nothing to do: the Default workshop (${result.workshopId}) already holds every document.`);
    } else {
      console.log(`${result.created ? "Created" : "Found"} the Default workshop ${result.workshopId}; attached ${JSON.stringify(result.backfilled)}.`);
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
