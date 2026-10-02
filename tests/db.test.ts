import { describe, expect, it } from "vitest";
import { getCollections, getDb } from "@/lib/db/client";
import { missingIndexes } from "@/lib/db/indexes";

describe("collections and indexes (T2)", () => {
  it("creates every collection and index of the data model at startup", async () => {
    const db = await getDb();
    const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).sort();
    expect(names).toEqual(["devs", "events", "helpRequests", "labs", "runs"]);
    expect(await missingIndexes(db)).toEqual([]);
  });

  it("refuses a duplicate event id", async () => {
    const { events } = await getCollections();
    const doc = { _id: "e1", devId: "d", type: "x.y", occurredAt: new Date(), receivedAt: new Date(), payload: {} };
    await events.insertOne(doc);
    await expect(events.insertOne(doc)).rejects.toMatchObject({ code: 11000 });
  });
});
