import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { POST as register } from "@/app/api/v1/devs/register/route";
import { GET as me } from "@/app/api/v1/devs/me/route";
import { CATALOG, event, json, registerDev, sendEvents } from "./helpers";

describe("public API protection (T3)", () => {
  it("refuses registration without or with a wrong workshop key", async () => {
    const body = { userId: randomUUID(), username: "john-dev" };
    expect((await register(json("POST", "/api/v1/devs/register", body))).status).toBe(401);
    expect((await register(json("POST", "/api/v1/devs/register", body, { "x-workshop-key": "nope" }))).status).toBe(401);
    const ok = await register(json("POST", "/api/v1/devs/register", body, { "x-workshop-key": "workshop-secret" }));
    expect(ok.status).toBe(201);
    const data = await ok.json();
    expect(data.devToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(data.userId).toBe(body.userId);
  });

  it("rejects events without a token (401) and with the token of another dev (403)", async () => {
    const a = await registerDev("alice");
    const b = await registerDev("bob");
    const events = [event({ type: "catalog.synced", payload: CATALOG })];
    const noToken = await sendEvents({ ...a, auth: {} }, events);
    expect(noToken.status).toBe(401);
    const wrongDev = await sendEvents({ ...b, auth: a.auth }, events);
    expect(wrongDev.status).toBe(403);
    expect((await wrongDev.json()).error).toBe("forbidden");
  });

  it("throttles a token after 120 requests in a minute with Retry-After", async () => {
    const dev = await registerDev("flood");
    let last: Response | undefined;
    for (let i = 0; i < 121; i += 1) {
      last = await sendEvents(dev, [event({ type: "heartbeat", payload: {} })]);
    }
    expect(last?.status).toBe(429);
    expect(last?.headers.get("retry-after")).toMatch(/^\d+$/);
    expect((await last!.json()).error).toBe("rateLimited");
  });

  it("validates the body: short username and malformed event type give 400 with details", async () => {
    const short = await register(json("POST", "/api/v1/devs/register", { userId: randomUUID(), username: "j" }, { "x-workshop-key": "workshop-secret" }));
    expect(short.status).toBe(400);
    expect((await short.json()).details.field).toBe("username");

    const dev = await registerDev();
    const bad = await sendEvents(dev, [event({ type: "heartbeat" }), event({ type: "Run_Started" })]);
    expect(bad.status).toBe(400);
    const body = await bad.json();
    expect(body.error).toBe("validation");
    expect(body.details.index).toBe(1);
  });

  it("GET /devs/me needs a token and returns the identity", async () => {
    const dev = await registerDev("carol");
    expect((await me(new Request("http://localhost/api/v1/devs/me"))).status).toBe(401);
    const response = await me(new Request("http://localhost/api/v1/devs/me", { headers: dev.auth }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ userId: dev.userId, username: "carol", activeHelpRequest: null, archived: false });
  });
});

describe("registration (T4)", () => {
  it("is idempotent for the token holder and refuses a copied id without the token", async () => {
    const dev = await registerDev("john-dev");
    const again = await register(json("POST", "/api/v1/devs/register", { userId: dev.userId, username: "john-renamed" }, { "x-workshop-key": "workshop-secret", ...dev.auth }));
    expect(again.status).toBe(200);
    const body = await again.json();
    expect(body.username).toBe("john-renamed");
    expect(body.devToken).toBeUndefined();

    const noToken = await register(json("POST", "/api/v1/devs/register", { userId: dev.userId, username: "hijack" }, { "x-workshop-key": "workshop-secret" }));
    expect(noToken.status).toBe(403);
    const wrongToken = await register(json("POST", "/api/v1/devs/register", { userId: dev.userId, username: "hijack" }, { "x-workshop-key": "workshop-secret", authorization: "Bearer not-the-token" }));
    expect(wrongToken.status).toBe(403);
  });
});
