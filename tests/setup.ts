import { inject, afterAll, beforeEach } from "vitest";
import { closeDb, getDb } from "@/lib/db/client";
import { resetRateLimits } from "@/lib/api/rateLimit";
import { resetLoginThrottle } from "@/lib/admin/loginThrottle";

process.env.MONGODB_URI = inject("mongoUri");
process.env.MONGODB_DB = `labs-admin-test-${process.pid}`;
process.env.WORKSHOP_KEY = "workshop-secret";
process.env.ADMIN_PASSWORD = "admin-secret";
process.env.SESSION_SECRET = "session-secret-session-secret";

beforeEach(async () => {
  const db = await getDb();
  for (const name of ["devs", "labs", "runs", "helpRequests", "events"]) {
    await db.collection(name).deleteMany({});
  }
  // The Default workshop (from WORKSHOP_KEY, created on connect) stays: the shared helpers register with its code.
  await db.collection("workshops").deleteMany({ legacy: { $ne: true } });
  resetRateLimits();
  resetLoginThrottle();
});

afterAll(async () => {
  const db = await getDb();
  await db.dropDatabase();
  await closeDb();
});
