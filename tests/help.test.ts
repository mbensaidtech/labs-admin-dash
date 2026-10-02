import { describe, expect, it } from "vitest";
import { POST as createHelp } from "@/app/api/v1/help-requests/route";
import { POST as cancelHelp } from "@/app/api/v1/help-requests/[id]/cancel/route";
import { GET as me } from "@/app/api/v1/devs/me/route";
import { POST as acknowledge } from "@/app/api/admin/help-requests/[id]/acknowledge/route";
import { POST as resolve } from "@/app/api/admin/help-requests/[id]/resolve/route";
import { GET as queue } from "@/app/api/admin/help-requests/route";
import { getCollections } from "@/lib/db/client";
import { getOverview, listEvents } from "@/lib/domain/queries";
import { adminCookie, json, registerDev, type RegisteredDev } from "./helpers";

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function raise(dev: RegisteredDev, extra: Record<string, unknown> = {}) {
  return createHelp(json("POST", "/api/v1/help-requests", { userId: dev.userId, username: dev.username, ...extra }, dev.auth));
}

describe("help requests (T6, T10)", () => {
  it("creates one open request, refuses a second one with the existing one, and syncs back", async () => {
    const dev = await registerDev();
    const created = await raise(dev, { labId: "azureopenai-lab03", message: "  stuck on tools  " });
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.status).toBe("open");

    const second = await raise(dev);
    expect(second.status).toBe(409);
    expect((await second.json()).details.existing.id).toBe(body.id);

    const sync = await (await me(new Request("http://localhost/api/v1/devs/me", { headers: dev.auth }))).json();
    expect(sync.activeHelpRequest).toMatchObject({ id: body.id, status: "open", labId: "azureopenai-lab03" });

    const overview = await getOverview();
    expect(overview.devs[0]).toMatchObject({ state: "needsHelp", activeHelpRequestId: body.id });
    expect(overview.counters.needsHelp).toBe(1);
    expect(overview.helpRequests[0]).toMatchObject({ id: body.id, message: "stuck on tools", dev: { username: dev.username } });
    const feed = await listEvents({ devId: dev.userId });
    expect(feed.items[0].type).toBe("help.requested");
  });

  it("the developer can cancel an open or acknowledged request, not a resolved one or someone else's", async () => {
    const alice = await registerDev("alice");
    const bob = await registerDev("bob");
    const admin = await adminCookie();
    const { id } = await (await raise(alice)).json();

    const notMine = await cancelHelp(json("POST", `/api/v1/help-requests/${id}/cancel`, { userId: bob.userId, username: "bob" }, bob.auth), params(id));
    expect(notMine.status).toBe(404);

    expect((await acknowledge(new Request("http://localhost", { method: "POST", headers: admin }), params(id))).status).toBe(200);
    const cancelled = await cancelHelp(json("POST", `/api/v1/help-requests/${id}/cancel`, { userId: alice.userId, username: "alice" }, alice.auth), params(id));
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toEqual({ id, status: "cancelled" });
    const { helpRequests } = await getCollections();
    expect(await helpRequests.findOne({ _id: id })).toMatchObject({ status: "cancelled", closedBy: "dev" });

    const again = await cancelHelp(json("POST", `/api/v1/help-requests/${id}/cancel`, { userId: alice.userId, username: "alice" }, alice.auth), params(id));
    expect(again.status).toBe(409);

    const { id: second } = await (await raise(alice)).json();
    expect((await resolve(json("POST", "", { adminNote: "fixed together" }, admin), params(second))).status).toBe(200);
    const afterResolve = await cancelHelp(json("POST", `/api/v1/help-requests/${second}/cancel`, { userId: alice.userId, username: "alice" }, alice.auth), params(second));
    expect(afterResolve.status).toBe(409);
    const sync = await (await me(new Request("http://localhost/api/v1/devs/me", { headers: alice.auth }))).json();
    expect(sync.activeHelpRequest).toBeNull();
    // The closed request stays readable with its note, so the local dashboard can show "Resolved: <note>".
    expect(sync.lastHelpRequest).toMatchObject({ id: second, status: "resolved", closedBy: "admin", adminNote: "fixed together" });
    expect(sync.lastHelpRequest.closedAt).toEqual(expect.any(String));
  });

  it("admin transitions: open → acknowledged → resolved with a note; terminal states are immutable", async () => {
    const dev = await registerDev();
    const admin = await adminCookie();
    const { id } = await (await raise(dev)).json();

    expect((await acknowledge(new Request("http://localhost", { method: "POST" }), params(id))).status).toBe(401);
    const ack = await acknowledge(new Request("http://localhost", { method: "POST", headers: admin }), params(id));
    expect(ack.status).toBe(200);
    expect((await ack.json()).status).toBe("acknowledged");
    expect((await acknowledge(new Request("http://localhost", { method: "POST", headers: admin }), params(id))).status).toBe(409);

    const open = await (await queue(new Request("http://localhost/api/admin/help-requests?status=open,acknowledged", { headers: admin }))).json();
    expect(open).toHaveLength(1);
    expect(open[0].status).toBe("acknowledged");

    const resolved = await resolve(json("POST", "", { adminNote: "see README step 3" }, admin), params(id));
    expect(resolved.status).toBe(200);
    expect(await resolved.json()).toMatchObject({ status: "resolved", adminNote: "see README step 3", closedBy: "admin" });
    expect((await resolve(json("POST", "", {}, admin), params(id))).status).toBe(409);
    expect((await acknowledge(new Request("http://localhost", { method: "POST", headers: admin }), params(id))).status).toBe(409);

    const history = await (await queue(new Request("http://localhost/api/admin/help-requests?status=resolved,cancelled", { headers: admin }))).json();
    expect(history[0].id).toBe(id);
    expect((await queue(new Request("http://localhost/api/admin/help-requests?status=bogus", { headers: admin }))).status).toBe(400);
  });

  it("a help request on an archived developer un-archives them", async () => {
    const dev = await registerDev();
    const { devs } = await getCollections();
    await devs.updateOne({ _id: dev.userId }, { $set: { archivedAt: new Date() } });
    await raise(dev);
    expect((await devs.findOne({ _id: dev.userId }))?.archivedAt).toBeNull();
  });

  it("the partial unique index refuses a second active request at the database level", async () => {
    const dev = await registerDev();
    const { helpRequests } = await getCollections();
    await helpRequests.insertOne({ _id: "h1", devId: dev.userId, status: "open", createdAt: new Date() });
    await expect(helpRequests.insertOne({ _id: "h2", devId: dev.userId, status: "acknowledged", createdAt: new Date() })).rejects.toMatchObject({ code: 11000 });
    await helpRequests.insertOne({ _id: "h3", devId: dev.userId, status: "resolved", createdAt: new Date() });
  });
});
