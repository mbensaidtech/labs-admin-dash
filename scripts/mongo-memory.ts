/**
 * Starts an in-memory MongoDB replica set (transactions enabled) for running the app without Docker.
 * Prints the connection string and keeps running until Ctrl+C.
 *
 *   pnpm mongo:memory            → prints MONGODB_URI=... (copy it to .env.local or export it)
 *   pnpm mongo:memory --port 27018
 */
import { MongoMemoryReplSet } from "mongodb-memory-server";

const portArg = process.argv.indexOf("--port");
const port = portArg >= 0 ? Number(process.argv[portArg + 1]) : 27017;

async function main() {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ port }],
  });
  const uri = replSet.getUri();
  console.log(`In-memory MongoDB replica set ready.\nMONGODB_URI=${uri}\nPress Ctrl+C to stop (all data is lost).`);

  const stop = async () => {
    await replSet.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await new Promise(() => undefined);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
