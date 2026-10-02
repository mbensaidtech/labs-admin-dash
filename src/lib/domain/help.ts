import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/api/errors";
import { getCollections } from "@/lib/db/client";
import { ACTIVE_HELP_STATUSES, type HelpRequestDoc } from "@/lib/db/types";

export interface HelpRequestDto {
  id: string;
  devId: string;
  labId?: string;
  message?: string;
  status: HelpRequestDoc["status"];
  createdAt: string;
  acknowledgedAt?: string;
  closedAt?: string;
  closedBy?: HelpRequestDoc["closedBy"];
  adminNote?: string;
}

export function toHelpDto(doc: HelpRequestDoc): HelpRequestDto {
  return {
    id: doc._id,
    devId: doc.devId,
    ...(doc.labId ? { labId: doc.labId } : {}),
    ...(doc.message ? { message: doc.message } : {}),
    status: doc.status,
    createdAt: doc.createdAt.toISOString(),
    ...(doc.acknowledgedAt ? { acknowledgedAt: doc.acknowledgedAt.toISOString() } : {}),
    ...(doc.closedAt ? { closedAt: doc.closedAt.toISOString() } : {}),
    ...(doc.closedBy ? { closedBy: doc.closedBy } : {}),
    ...(doc.adminNote ? { adminNote: doc.adminNote } : {}),
  };
}

export async function findActiveHelpRequest(devId: string): Promise<HelpRequestDoc | null> {
  const { helpRequests } = await getCollections();
  return helpRequests.findOne({ devId, status: { $in: [...ACTIVE_HELP_STATUSES] } });
}

/** The most recent request of a developer, whatever its status (sync-back of the resolution note). */
export async function findLastHelpRequest(devId: string): Promise<HelpRequestDoc | null> {
  const { helpRequests } = await getCollections();
  return helpRequests.findOne({ devId }, { sort: { createdAt: -1 } });
}

/** Business Rule 9: at most one active request per developer (409 carrying the existing one). */
export async function createHelpRequest(
  devId: string,
  input: { labId?: string; message?: string },
  now = new Date(),
): Promise<HelpRequestDoc> {
  const { helpRequests, events, devs } = await getCollections();
  const existing = await findActiveHelpRequest(devId);
  if (existing) {
    throw new ApiError("conflict", "A help request is already active", { existing: toHelpDto(existing) });
  }

  const doc: HelpRequestDoc = {
    _id: randomUUID(),
    devId,
    ...(input.labId ? { labId: input.labId } : {}),
    ...(input.message?.trim() ? { message: input.message.trim() } : {}),
    status: "open",
    createdAt: now,
  };

  try {
    await helpRequests.insertOne(doc);
  } catch (error) {
    // The partial unique index caught a concurrent creation: report the winner.
    if ((error as { code?: number }).code === 11000) {
      const winner = await findActiveHelpRequest(devId);
      throw new ApiError("conflict", "A help request is already active", {
        existing: winner ? toHelpDto(winner) : undefined,
      });
    }
    throw error;
  }

  await events.insertOne({
    _id: randomUUID(),
    devId,
    type: "help.requested",
    ...(doc.labId ? { labId: doc.labId } : {}),
    occurredAt: now,
    receivedAt: now,
    payload: { helpRequestId: doc._id, message: doc.message ?? null },
  });
  // Asking for help is an activity, and un-archives the developer (Business Rule 16).
  await devs.updateOne(
    { _id: devId },
    { $set: { lastSeenAt: now, lastActivityAt: now, lastActivityType: "help.requested", archivedAt: null, ...(doc.labId ? { lastActivityLab: doc.labId } : {}) } },
  );
  return doc;
}

/** Developer side: open / acknowledged → cancelled. 404 when the request is not this developer's. */
export async function cancelHelpRequest(devId: string, id: string, now = new Date()): Promise<HelpRequestDoc> {
  const { helpRequests, events } = await getCollections();
  const current = await helpRequests.findOne({ _id: id, devId });
  if (!current) {
    throw new ApiError("notFound", "Help request not found");
  }
  const updated = await helpRequests.findOneAndUpdate(
    { _id: id, devId, status: { $in: [...ACTIVE_HELP_STATUSES] } },
    { $set: { status: "cancelled", closedAt: now, closedBy: "dev" } },
    { returnDocument: "after" },
  );
  if (!updated) {
    throw new ApiError("conflict", `Help request is already ${current.status}`, { status: current.status });
  }
  await events.insertOne({
    _id: randomUUID(),
    devId,
    type: "help.cancelled",
    ...(updated.labId ? { labId: updated.labId } : {}),
    occurredAt: now,
    receivedAt: now,
    payload: { helpRequestId: id },
  });
  return updated;
}

/** Admin side: open → acknowledged (409 otherwise, first write wins). */
export async function acknowledgeHelpRequest(id: string, now = new Date()): Promise<HelpRequestDoc> {
  const { helpRequests } = await getCollections();
  const current = await helpRequests.findOne({ _id: id });
  if (!current) {
    throw new ApiError("notFound", "Help request not found");
  }
  const updated = await helpRequests.findOneAndUpdate(
    { _id: id, status: "open" },
    { $set: { status: "acknowledged", acknowledgedAt: now } },
    { returnDocument: "after" },
  );
  if (!updated) {
    throw new ApiError("conflict", `Help request is already ${current.status}`, { status: current.status });
  }
  return updated;
}

/** Admin side: open / acknowledged → resolved, with an optional note. */
export async function resolveHelpRequest(id: string, adminNote: string | undefined, now = new Date()): Promise<HelpRequestDoc> {
  const { helpRequests, events } = await getCollections();
  const current = await helpRequests.findOne({ _id: id });
  if (!current) {
    throw new ApiError("notFound", "Help request not found");
  }
  const note = adminNote?.trim();
  const updated = await helpRequests.findOneAndUpdate(
    { _id: id, status: { $in: [...ACTIVE_HELP_STATUSES] } },
    { $set: { status: "resolved", closedAt: now, closedBy: "admin", ...(note ? { adminNote: note } : {}) } },
    { returnDocument: "after" },
  );
  if (!updated) {
    throw new ApiError("conflict", `Help request is already ${current.status}`, { status: current.status });
  }
  await events.insertOne({
    _id: randomUUID(),
    devId: updated.devId,
    type: "help.resolved",
    ...(updated.labId ? { labId: updated.labId } : {}),
    occurredAt: now,
    receivedAt: now,
    payload: { helpRequestId: id, adminNote: note ?? null },
  });
  return updated;
}
