import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import type { WorkshopDoc } from "@/lib/db/types";
import { normalizeWorkshopCode } from "@/lib/domain/workshopCode";

export const LEGACY_WORKSHOP_NAME = "Default workshop";
const STAMPED = ["devs", "runs", "events", "helpRequests"] as const;

export interface LegacyMigrationResult {
  workshopId: string | null;
  created: boolean;
  backfilled: Record<(typeof STAMPED)[number], number>;
}

/**
 * Business Rule 9: the WORKSHOP_KEY of a single-cohort deployment becomes the "Default workshop", and every document
 * written before workshops existed is attached to it. Idempotent; never touches an existing workshop.
 */
export async function migrateLegacyWorkshop(db: Db, workshopKey: string, now = new Date()): Promise<LegacyMigrationResult> {
  const result: LegacyMigrationResult = { workshopId: null, created: false, backfilled: { devs: 0, runs: 0, events: 0, helpRequests: 0 } };
  const code = normalizeWorkshopCode(workshopKey);
  if (!code) return result;

  const workshops = db.collection<WorkshopDoc>("workshops");
  let workshop = await workshops.findOne({ code });
  if (!workshop) {
    const doc: WorkshopDoc = { _id: randomUUID(), name: LEGACY_WORKSHOP_NAME, code, status: "active", createdAt: now, updatedAt: now, closedAt: null, legacy: true };
    try {
      await workshops.insertOne(doc);
      workshop = doc;
      result.created = true;
    } catch (error) {
      // Another instance created it at the same time.
      if ((error as { code?: number }).code !== 11000) throw error;
      workshop = await workshops.findOne({ code });
      if (!workshop) return result;
    }
  }
  result.workshopId = workshop._id;

  // Cheap check on the small collection first: once every developer has a workshop, nothing older is left to stamp.
  const unassigned = await db.collection("devs").countDocuments({ workshopId: { $exists: false } }, { limit: 1 });
  if (unassigned === 0 && !result.created) return result;

  for (const name of STAMPED) {
    const updated = await db.collection(name).updateMany({ workshopId: { $exists: false } }, { $set: { workshopId: workshop._id } });
    result.backfilled[name] = updated.modifiedCount;
  }
  return result;
}
