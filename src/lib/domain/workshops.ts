import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/api/errors";
import { getCollections } from "@/lib/db/client";
import type { WorkshopDoc, WorkshopStatus } from "@/lib/db/types";
import { generateWorkshopCode, normalizeWorkshopCode } from "@/lib/domain/workshopCode";

export interface WorkshopRefDto {
  id: string;
  name: string;
}

export interface WorkshopDto extends WorkshopRefDto {
  code: string;
  status: WorkshopStatus;
  legacy: boolean;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  codeRotatedAt?: string;
  devs: { active: number; total: number };
}

const MAX_CODE_ATTEMPTS = 5;

export function toWorkshopDto(doc: WorkshopDoc, counts = { active: 0, total: 0 }): WorkshopDto {
  return {
    id: doc._id,
    name: doc.name,
    code: doc.code,
    status: doc.status,
    legacy: Boolean(doc.legacy),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    ...(doc.closedAt ? { closedAt: doc.closedAt.toISOString() } : {}),
    ...(doc.codeRotatedAt ? { codeRotatedAt: doc.codeRotatedAt.toISOString() } : {}),
    devs: counts,
  };
}

function isDuplicateKey(error: unknown): boolean {
  return (error as { code?: number }).code === 11000;
}

/** Business Rules 1 and 4: the workshop a registration joins. 401 for an unknown code or a closed workshop. */
export async function workshopForRegistration(rawCode: string): Promise<WorkshopDoc> {
  const code = normalizeWorkshopCode(rawCode);
  if (!code) {
    throw new ApiError("unauthorized", "A valid X-Workshop-Key header is required");
  }
  const { workshops } = await getCollections();
  const workshop = await workshops.findOne({ code });
  if (!workshop) {
    throw new ApiError("unauthorized", "A valid X-Workshop-Key header is required");
  }
  if (workshop.status === "closed") {
    throw new ApiError("unauthorized", "This workshop is closed");
  }
  return workshop;
}

/** Active workshops first (newest first), then closed ones; with developer counts (archived included in `total`). */
export async function listWorkshops(): Promise<WorkshopDto[]> {
  const { workshops, devs } = await getCollections();
  const [docs, counts] = await Promise.all([
    workshops.find({}).sort({ createdAt: -1 }).toArray(),
    devs
      .aggregate<{ _id: string; total: number; active: number }>([
        { $match: { workshopId: { $exists: true } } },
        {
          $group: {
            _id: "$workshopId",
            total: { $sum: 1 },
            active: { $sum: { $cond: [{ $ifNull: ["$archivedAt", false] }, 0, 1] } },
          },
        },
      ])
      .toArray(),
  ]);
  const byId = new Map(counts.map((count) => [count._id, { active: count.active, total: count.total }]));
  const active = docs.filter((doc) => doc.status === "active");
  const closed = docs.filter((doc) => doc.status === "closed");
  return [...active, ...closed].map((doc) => toWorkshopDto(doc, byId.get(doc._id)));
}

/** Names of every workshop, for labelling developers in "All workshops" mode. */
export async function workshopNames(): Promise<Map<string, string>> {
  const { workshops } = await getCollections();
  const docs = await workshops.find({}, { projection: { name: 1 } }).toArray();
  return new Map(docs.map((doc) => [doc._id, doc.name]));
}

/** Business Rule 8: an unknown scope is a 404, never silently "all". */
export async function assertWorkshopExists(id: string): Promise<void> {
  const { workshops } = await getCollections();
  if (!(await workshops.countDocuments({ _id: id }, { limit: 1 }))) {
    throw new ApiError("notFound", "Workshop not found");
  }
}

async function getWorkshopDto(id: string): Promise<WorkshopDto> {
  const { workshops, devs } = await getCollections();
  const doc = await workshops.findOne({ _id: id });
  if (!doc) {
    throw new ApiError("notFound", "Workshop not found");
  }
  const [total, active] = await Promise.all([
    devs.countDocuments({ workshopId: id }),
    devs.countDocuments({ workshopId: id, $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }] }),
  ]);
  return toWorkshopDto(doc, { active, total });
}

export async function createWorkshop(name: string, now = new Date()): Promise<WorkshopDto> {
  const { workshops } = await getCollections();
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    const doc: WorkshopDoc = { _id: randomUUID(), name, code: generateWorkshopCode(), status: "active", createdAt: now, updatedAt: now, closedAt: null };
    try {
      await workshops.insertOne(doc);
      return toWorkshopDto(doc);
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
    }
  }
  throw new ApiError("internal", "Could not generate a unique workshop code");
}

export async function updateWorkshop(id: string, changes: { name?: string; status?: WorkshopStatus }, now = new Date()): Promise<WorkshopDto> {
  const { workshops } = await getCollections();
  const set: Partial<WorkshopDoc> = { updatedAt: now };
  if (changes.name !== undefined) set.name = changes.name;
  if (changes.status !== undefined) {
    set.status = changes.status;
    set.closedAt = changes.status === "closed" ? now : null;
  }
  const result = await workshops.updateOne({ _id: id }, { $set: set });
  if (result.matchedCount === 0) {
    throw new ApiError("notFound", "Workshop not found");
  }
  return getWorkshopDto(id);
}

/** Business Rule 3: the old code stops working at once; registered developers keep their dev token. */
export async function rotateWorkshopCode(id: string, now = new Date()): Promise<WorkshopDto> {
  const { workshops } = await getCollections();
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    try {
      const result = await workshops.updateOne({ _id: id }, { $set: { code: generateWorkshopCode(), codeRotatedAt: now, updatedAt: now } });
      if (result.matchedCount === 0) {
        throw new ApiError("notFound", "Workshop not found");
      }
      return getWorkshopDto(id);
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
    }
  }
  throw new ApiError("internal", "Could not generate a unique workshop code");
}

/** Business Rule 5: only an empty workshop (no developer at all, archived included) can be deleted. */
export async function deleteWorkshop(id: string): Promise<void> {
  const { workshops, devs } = await getCollections();
  if (!(await workshops.countDocuments({ _id: id }, { limit: 1 }))) {
    throw new ApiError("notFound", "Workshop not found");
  }
  const total = await devs.countDocuments({ workshopId: id });
  if (total > 0) {
    throw new ApiError("conflict", `This workshop has ${total} developer(s)`, { devs: total });
  }
  await workshops.deleteOne({ _id: id });
}
