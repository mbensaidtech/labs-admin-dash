import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { POST as register } from "@/app/api/v1/devs/register/route";
import { POST as createHelp } from "@/app/api/v1/help-requests/route";
import { GET as listRoute, POST as createRoute } from "@/app/api/admin/workshops/route";
import { DELETE as deleteRoute, PATCH as patchRoute } from "@/app/api/admin/workshops/[id]/route";
import { POST as rotateRoute } from "@/app/api/admin/workshops/[id]/rotate-code/route";
import { GET as overview } from "@/app/api/admin/overview/route";
import { GET as matrix } from "@/app/api/admin/matrix/route";
import { GET as queue } from "@/app/api/admin/help-requests/route";
import { GET as feed } from "@/app/api/admin/events/route";
import { getCollections, getDb } from "@/lib/db/client";
import { LEGACY_WORKSHOP_NAME, migrateLegacyWorkshop } from "@/lib/db/legacyWorkshop";
import { CODE_ALPHABET, generateWorkshopCode, normalizeWorkshopCode } from "@/lib/domain/workshopCode";
import { formatWorkshopCode } from "@/lib/domain/workshopFormat";
import type { WorkshopDto } from "@/lib/domain/workshops";
import { adminCookie, CATALOG, event, json, sendEvents, type RegisteredDev } from "./helpers";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const admin = () => adminCookie();

async function createWorkshop(name: string, cookie: Record<string, string>): Promise<WorkshopDto> {
  const response = await createRoute(json("POST", "/api/admin/workshops", { name }, cookie));
  expect(response.status).toBe(201);
  return response.json();
}

async function join(code: string, username: string, userId: string = randomUUID(), auth: Record<string, string> = {}): Promise<Response> {
  return register(json("POST", "/api/v1/devs/register", { userId, username }, { "x-workshop-key": code, ...auth }));
}

async function joinDev(code: string, username: string): Promise<RegisteredDev> {
  const userId = randomUUID();
  const response = await join(code, username, userId);
  expect(response.status).toBe(201);
  const { devToken } = (await response.json()) as { devToken: string };
  return { userId, username, token: devToken, auth: { authorization: `Bearer ${devToken}` } };
}

function get(path: string, cookie: Record<string, string>): Request {
  return new Request(`http://localhost${path}`, { headers: cookie });
}

describe("workshop codes (Business Rule 2)", () => {
  it("generates 8 unambiguous characters and normalizes what students type", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateWorkshopCode();
      expect(code).toHaveLength(8);
      expect([...code].every((char) => CODE_ALPHABET.includes(char))).toBe(true);
    }
    expect(CODE_ALPHABET).not.toMatch(/[01OIL]/);
    expect(normalizeWorkshopCode(" k7qx-9mpa ")).toBe("K7QX9MPA");
    expect(normalizeWorkshopCode("K7QX 9MPA")).toBe("K7QX9MPA");
    expect(formatWorkshopCode("K7QX9MPA")).toBe("K7QX-9MPA");
    expect(formatWorkshopCode("A-LONG+LEGACY/KEY=")).toBe("A-LONG+LEGACY/KEY=");
  });
});

describe("workshop admin API (T4)", () => {
  it("requires the admin session on every route (Business Rule 10)", async () => {
    const anonymous = {};
    expect((await listRoute(get("/api/admin/workshops", anonymous))).status).toBe(401);
    expect((await createRoute(json("POST", "/api/admin/workshops", { name: "Paris" }))).status).toBe(401);
    expect((await patchRoute(json("PATCH", "/api/admin/workshops/x", { name: "Lyon" }), params("x"))).status).toBe(401);
    expect((await rotateRoute(json("POST", "/api/admin/workshops/x/rotate-code"), params("x"))).status).toBe(401);
    expect((await deleteRoute(json("DELETE", "/api/admin/workshops/x"), params("x"))).status).toBe(401);
  });

  it("validates the name", async () => {
    const cookie = await admin();
    for (const name of ["", " a ", "x".repeat(81)]) {
      const response = await createRoute(json("POST", "/api/admin/workshops", { name }, cookie));
      expect(response.status).toBe(400);
      expect((await response.json()).details.field).toBe("name");
    }
  });

  it("creates, renames, closes, reopens, rotates and deletes (only when empty)", async () => {
    const cookie = await admin();
    const paris = await createWorkshop("  Paris 14 Oct  ", cookie);
    expect(paris).toMatchObject({ name: "Paris 14 Oct", status: "active", devs: { active: 0, total: 0 } });
    expect(paris.code).toMatch(/^[A-Z2-9]{8}$/);

    const renamed = await (await patchRoute(json("PATCH", `/api/admin/workshops/${paris.id}`, { name: "Paris" }, cookie), params(paris.id))).json();
    expect(renamed.name).toBe("Paris");

    const closed = await (await patchRoute(json("PATCH", `/api/admin/workshops/${paris.id}`, { status: "closed" }, cookie), params(paris.id))).json();
    expect(closed.status).toBe("closed");
    expect(closed.closedAt).toBeDefined();
    const list: WorkshopDto[] = await (await listRoute(get("/api/admin/workshops", cookie))).json();
    expect(list[list.length - 1].id).toBe(paris.id); // closed ones come last
    const reopened = await (await patchRoute(json("PATCH", `/api/admin/workshops/${paris.id}`, { status: "active" }, cookie), params(paris.id))).json();
    expect(reopened.status).toBe("active");

    const rotated = await (await rotateRoute(json("POST", "/x", undefined, cookie), params(paris.id))).json();
    expect(rotated.code).not.toBe(paris.code);

    await joinDev(rotated.code, "alice");
    const blocked = await deleteRoute(json("DELETE", "/x", undefined, cookie), params(paris.id));
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).details.devs).toBe(1);

    const empty = await createWorkshop("Empty", cookie);
    expect((await deleteRoute(json("DELETE", "/x", undefined, cookie), params(empty.id))).status).toBe(204);
    expect((await deleteRoute(json("DELETE", "/x", undefined, cookie), params(empty.id))).status).toBe(404);
  });
});

describe("registration with workshop codes (T2)", () => {
  it("accepts an active code in any typed form and attaches the dev to the workshop", async () => {
    const cookie = await admin();
    const paris = await createWorkshop("Paris", cookie);
    const typed = formatWorkshopCode(paris.code).toLowerCase();
    const dev = await joinDev(typed, "alice");
    const { devs } = await getCollections();
    expect((await devs.findOne({ _id: dev.userId }))?.workshopId).toBe(paris.id);
    expect((await join(paris.code.replace(/(.{4})/, "$1 "), "bob")).status).toBe(201);
  });

  it("rejects unknown, rotated and closed-workshop codes with 401", async () => {
    const cookie = await admin();
    const paris = await createWorkshop("Paris", cookie);
    expect((await join("ZZZZ-ZZZZ", "alice")).status).toBe(401);

    const rotated: WorkshopDto = await (await rotateRoute(json("POST", "/x", undefined, cookie), params(paris.id))).json();
    expect((await join(paris.code, "alice")).status).toBe(401);
    expect((await join(rotated.code, "alice")).status).toBe(201);

    await patchRoute(json("PATCH", "/x", { status: "closed" }, cookie), params(paris.id));
    const closed = await join(rotated.code, "bob");
    expect(closed.status).toBe(401);
    expect((await closed.json()).message).toBe("This workshop is closed");
  });

  it("moves a registered dev who joins with another workshop's code (Business Rule 6)", async () => {
    const cookie = await admin();
    const a = await createWorkshop("Session A", cookie);
    const b = await createWorkshop("Session B", cookie);
    const dev = await joinDev(a.code, "alice");
    await sendEvents(dev, [event({ type: "catalog.synced", payload: CATALOG })]);

    const moved = await join(b.code, "alice", dev.userId, dev.auth);
    expect(moved.status).toBe(200);
    await sendEvents(dev, [event({ type: "lab.opened", labId: "azureopenai-lab01" })]);

    const { devs, events } = await getCollections();
    expect((await devs.findOne({ _id: dev.userId }))?.workshopId).toBe(b.id);
    const stamped = await events.find({ devId: dev.userId }).sort({ receivedAt: 1 }).toArray();
    expect(stamped.map((e) => [e.type, e.workshopId])).toEqual([
      ["catalog.synced", a.id],
      ["lab.opened", b.id],
    ]);
  });
});

describe("stamping and scoped admin views (T3, T6)", () => {
  it("keeps two workshops apart in overview, matrix, help queue and feed", async () => {
    const cookie = await admin();
    const a = await createWorkshop("Workshop A", cookie);
    const b = await createWorkshop("Workshop B", cookie);
    const alice = await joinDev(a.code, "alice");
    const bob = await joinDev(b.code, "bob");
    for (const dev of [alice, bob]) {
      await sendEvents(dev, [
        event({ type: "catalog.synced", payload: CATALOG }),
        event({ type: "run.started", labId: "azureopenai-lab01", payload: { runId: `run-${dev.username}`, target: "start" } }),
      ]);
      const help = await createHelp(json("POST", "/api/v1/help-requests", { userId: dev.userId, username: dev.username }, dev.auth));
      expect(help.status).toBe(201);
    }

    const { runs, helpRequests } = await getCollections();
    expect((await runs.findOne({ _id: "run-alice" }))?.workshopId).toBe(a.id);
    expect((await helpRequests.findOne({ devId: bob.userId }))?.workshopId).toBe(b.id);

    const scopedOverview = await (await overview(get(`/api/admin/overview?workshopId=${a.id}`, cookie))).json();
    expect(scopedOverview.devs.map((d: { username: string }) => d.username)).toEqual(["alice"]);
    expect(scopedOverview.counters).toMatchObject({ devs: 1, needsHelp: 1 });
    expect(scopedOverview.helpRequests).toHaveLength(1);
    expect(scopedOverview.scope).toBe(a.id);

    const all = await (await overview(get("/api/admin/overview", cookie))).json();
    expect(all.counters.devs).toBe(2);
    expect(all.devs.find((d: { username: string }) => d.username === "bob").workshop).toEqual({ id: b.id, name: "Workshop B" });

    const scopedMatrix = await (await matrix(get(`/api/admin/matrix?workshopId=${b.id}`, cookie))).json();
    expect(scopedMatrix.rows.map((r: { dev: { username: string } }) => r.dev.username)).toEqual(["bob"]);

    const scopedQueue = await (await queue(get(`/api/admin/help-requests?status=open&workshopId=${a.id}`, cookie))).json();
    expect(scopedQueue.map((h: { dev: { username: string } }) => h.dev.username)).toEqual(["alice"]);
    expect((await (await queue(get("/api/admin/help-requests?status=open", cookie))).json())).toHaveLength(2);

    const scopedFeed = await (await feed(get(`/api/admin/events?workshopId=${b.id}`, cookie))).json();
    expect(new Set(scopedFeed.items.map((e: { devId: string }) => e.devId))).toEqual(new Set([bob.userId]));

    expect((await overview(get("/api/admin/overview?workshopId=missing", cookie))).status).toBe(404);
  });

  it("still accepts events and help requests from a closed workshop (Business Rule 4)", async () => {
    const cookie = await admin();
    const a = await createWorkshop("Session A", cookie);
    const dev = await joinDev(a.code, "alice");
    await patchRoute(json("PATCH", "/x", { status: "closed" }, cookie), params(a.id));
    expect((await sendEvents(dev, [event({ type: "heartbeat" })])).status).toBe(202);
    const help = await createHelp(json("POST", "/api/v1/help-requests", { userId: dev.userId, username: dev.username }, dev.auth));
    expect(help.status).toBe(201);
  });
});

describe("legacy WORKSHOP_KEY migration (T8)", () => {
  it("creates the Default workshop once and attaches older documents to it", async () => {
    const db = await getDb();
    const { devs, events, workshops } = await getCollections();
    await devs.insertOne({
      _id: "old-dev", username: "old", tokenHash: "x", createdAt: new Date(), lastSeenAt: new Date(), lastActivityAt: new Date(),
      archivedAt: null, catalogLabIds: [], progress: {},
    });
    await events.insertOne({ _id: "old-event", devId: "old-dev", type: "heartbeat", occurredAt: new Date(), receivedAt: new Date(), payload: {} });

    const first = await migrateLegacyWorkshop(db, "Legacy-Key-123");
    expect(first.created).toBe(true);
    expect(first.backfilled).toMatchObject({ devs: 1, events: 1 });
    const legacy = await workshops.findOne({ code: "LEGACYKEY123" });
    expect(legacy).toMatchObject({ name: LEGACY_WORKSHOP_NAME, legacy: true, status: "active" });
    expect((await devs.findOne({ _id: "old-dev" }))?.workshopId).toBe(legacy?._id);

    const second = await migrateLegacyWorkshop(db, "legacy-key-123");
    expect(second).toMatchObject({ created: false, workshopId: legacy?._id, backfilled: { devs: 0, runs: 0, events: 0, helpRequests: 0 } });
    expect(await workshops.countDocuments({ code: "LEGACYKEY123" })).toBe(1);

    expect((await migrateLegacyWorkshop(db, "")).workshopId).toBeNull();
    await workshops.deleteOne({ code: "LEGACYKEY123" });
  });

  it("lets a dashboard still configured with the old key register", async () => {
    // tests/setup.ts sets WORKSHOP_KEY=workshop-secret; the connection created its Default workshop.
    expect((await join("workshop-secret", "legacy-dev")).status).toBe(201);
  });
});
