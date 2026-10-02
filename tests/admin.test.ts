import { describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/admin/login/route";
import { POST as logout } from "@/app/api/admin/logout/route";
import { GET as overview } from "@/app/api/admin/overview/route";
import { GET as matrix } from "@/app/api/admin/matrix/route";
import { GET as detail } from "@/app/api/admin/devs/[id]/route";
import { POST as archive } from "@/app/api/admin/devs/[id]/archive/route";
import { POST as unarchive } from "@/app/api/admin/devs/[id]/unarchive/route";
import { GET as events } from "@/app/api/admin/events/route";
import { GET as health } from "@/app/api/v1/health/route";
import { getCollections } from "@/lib/db/client";
import { createSessionValue, SESSION_COOKIE, verifySessionValue } from "@/lib/admin/session";
import { adminCookie, CATALOG, event, json, registerDev, sendEvents } from "./helpers";

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("admin session (T7)", () => {
  it("logs in with the password, sets a signed httpOnly cookie, and logs out", async () => {
    const response = await login(json("POST", "/api/admin/login", { password: "admin-secret" }));
    expect(response.status).toBe(204);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
    const value = cookie.split(";")[0].split("=")[1];
    expect(await verifySessionValue("session-secret-session-secret", value)).toBe(true);
    expect(await verifySessionValue("other-secret", value)).toBe(false);

    const out = await logout(new Request("http://localhost/api/admin/logout", { method: "POST" }));
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("answers 401 without a session and 200 with it", async () => {
    expect((await overview(new Request("http://localhost/api/admin/overview"))).status).toBe(401);
    const admin = await adminCookie();
    const ok = await overview(new Request("http://localhost/api/admin/overview", { headers: admin }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ counters: { devs: 0 }, devs: [], labs: [] });
  });

  it("rejects an expired or tampered cookie", async () => {
    const expired = await createSessionValue("session-secret-session-secret", Date.now() - 13 * 3600 * 1000);
    expect((await overview(new Request("http://localhost/api/admin/overview", { headers: { cookie: `${SESSION_COOKIE}=${expired}` } }))).status).toBe(401);
    const valid = await createSessionValue("session-secret-session-secret");
    const tampered = valid.slice(0, -1) + (valid.endsWith("0") ? "1" : "0");
    expect((await overview(new Request("http://localhost/api/admin/overview", { headers: { cookie: `${SESSION_COOKIE}=${tampered}` } }))).status).toBe(401);
  });

  it("throttles after five wrong passwords, even with the right one", async () => {
    const headers = { "x-forwarded-for": "203.0.113.7" };
    for (let i = 0; i < 5; i += 1) {
      expect((await login(json("POST", "/api/admin/login", { password: "wrong" }, headers))).status).toBe(401);
    }
    const blocked = await login(json("POST", "/api/admin/login", { password: "admin-secret" }, headers));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toMatch(/^\d+$/);
    // Another address is not affected.
    expect((await login(json("POST", "/api/admin/login", { password: "admin-secret" }, { "x-forwarded-for": "203.0.113.8" }))).status).toBe(204);
  });
});

describe("admin read API (T8, T9, T11)", () => {
  it("overview sorts needs-help first, matrix flags blocked cells, detail lists runs and feed, archive hides", async () => {
    const admin = await adminCookie();
    const alice = await registerDev("alice");
    const bob = await registerDev("bob");
    for (const dev of [alice, bob]) {
      await sendEvents(dev, [event({ type: "catalog.synced", payload: CATALOG })]);
    }
    await sendEvents(alice, [
      event({ type: "run.started", labId: "azureopenai-lab01", payload: { runId: "a1", target: "start" } }),
      event({ type: "run.finished", labId: "azureopenai-lab01", payload: { runId: "a1", target: "start", status: "passed", durationMs: 1500, checks: [{ id: "c", passed: true }] } }),
    ]);
    const { helpRequests } = await getCollections();
    await helpRequests.insertOne({ _id: "h-bob", devId: bob.userId, labId: "azureopenai-lab02", status: "open", createdAt: new Date() });

    const ov = await (await overview(new Request("http://localhost/api/admin/overview", { headers: admin }))).json();
    expect(ov.devs.map((d: { username: string }) => d.username)).toEqual(["bob", "alice"]);
    expect(ov.devs[0].state).toBe("needsHelp");
    expect(ov.devs[1]).toMatchObject({ state: "online", completed: 1, total: 3 });
    expect(ov.counters).toMatchObject({ devs: 2, online: 2, needsHelp: 1, completedLabs: 1 });
    expect(ov.labs.map((l: { id: string }) => l.id)).toEqual(["azureopenai-lab01", "azureopenai-lab02", "azureopenai-lab03"]);

    const mx = await (await matrix(new Request("http://localhost/api/admin/matrix", { headers: admin }))).json();
    expect(mx.labs).toHaveLength(3);
    const bobRow = mx.rows.find((r: { dev: { username: string } }) => r.dev.username === "bob");
    expect(bobRow.cells[1]).toMatchObject({ labId: "azureopenai-lab02", blocked: true, state: "notStarted" });
    const aliceRow = mx.rows.find((r: { dev: { username: string } }) => r.dev.username === "alice");
    expect(aliceRow.cells[0]).toMatchObject({ state: "completed", lastRunStatus: "passed", runCount: 1 });

    const det = await (await detail(new Request("http://localhost", { headers: admin }), params(alice.userId))).json();
    expect(det.runs).toHaveLength(1);
    expect(det.runs[0]).toMatchObject({ id: "a1", status: "passed", checksPassed: 1, checksTotal: 1, durationMs: 1500 });
    expect(det.progress[0]).toMatchObject({ display: "completed", runCount: 1 });
    expect(det.events.map((e: { type: string }) => e.type)).toEqual(["run.finished", "run.started", "catalog.synced"]);
    expect((await detail(new Request("http://localhost", { headers: admin }), params("nope"))).status).toBe(404);

    expect((await archive(new Request("http://localhost", { method: "POST", headers: admin }), params(bob.userId))).status).toBe(200);
    const hidden = await (await overview(new Request("http://localhost/api/admin/overview", { headers: admin }))).json();
    expect(hidden.devs).toHaveLength(1);
    expect((await unarchive(new Request("http://localhost", { method: "POST", headers: admin }), params(bob.userId))).status).toBe(200);
    expect((await (await overview(new Request("http://localhost/api/admin/overview", { headers: admin }))).json()).devs).toHaveLength(2);
  });

  it("paginates the feed with a cursor", async () => {
    const admin = await adminCookie();
    const dev = await registerDev();
    const batch = Array.from({ length: 60 }, (_, i) => event({ type: "lab.opened", labId: `lab-${String(i).padStart(2, "0")}` }));
    expect((await sendEvents(dev, batch)).status).toBe(202);
    const page1 = await (await events(new Request(`http://localhost/api/admin/events?devId=${dev.userId}`, { headers: admin }))).json();
    expect(page1.items).toHaveLength(50);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = await (await events(new Request(`http://localhost/api/admin/events?devId=${dev.userId}&cursor=${page1.nextCursor}`, { headers: admin }))).json();
    expect(page2.items).toHaveLength(10);
    expect(page2.nextCursor).toBeNull();
    const ids = new Set([...page1.items, ...page2.items].map((e: { id: string }) => e.id));
    expect(ids.size).toBe(60);
    expect((await events(new Request("http://localhost/api/admin/events?cursor=garbage", { headers: admin }))).status).toBe(400);
  });

  it("health reports the database", async () => {
    const response = await health();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok", db: "ok" });
  });
});
