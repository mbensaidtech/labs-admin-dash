import { randomUUID } from "node:crypto";
import { POST as register } from "@/app/api/v1/devs/register/route";
import { POST as postEvents } from "@/app/api/v1/events/route";
import { POST as login } from "@/app/api/admin/login/route";

export const BASE = "http://localhost:3000";

export function json(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export interface RegisteredDev {
  userId: string;
  username: string;
  token: string;
  auth: Record<string, string>;
}

export async function registerDev(username = "john-dev", userId = randomUUID()): Promise<RegisteredDev> {
  const response = await register(json("POST", "/api/v1/devs/register", { userId, username, platform: "macOS", dashboardVersion: "1.0" }, { "x-workshop-key": "workshop-secret" }));
  if (response.status !== 201) {
    throw new Error(`register failed: ${response.status} ${await response.text()}`);
  }
  const data = (await response.json()) as { devToken: string };
  return { userId, username, token: data.devToken, auth: { authorization: `Bearer ${data.devToken}` } };
}

export interface EventSpec {
  type: string;
  labId?: string;
  payload?: unknown;
  eventId?: string;
  occurredAt?: string;
}

export function event(spec: EventSpec) {
  return {
    eventId: spec.eventId ?? randomUUID(),
    type: spec.type,
    occurredAt: spec.occurredAt ?? new Date().toISOString(),
    ...(spec.labId ? { labId: spec.labId } : {}),
    payload: spec.payload ?? {},
  };
}

export async function sendEvents(dev: RegisteredDev, events: ReturnType<typeof event>[]): Promise<Response> {
  return postEvents(json("POST", "/api/v1/events", { userId: dev.userId, username: dev.username, events }, dev.auth));
}

export const CATALOG = {
  labs: [
    { id: "azureopenai-lab01", number: "01", track: "Azure OpenAI", title: "First Basic AI Agent", level: "Beginner", interactive: false, sortOrder: 1 },
    { id: "azureopenai-lab02", number: "02", track: "Azure OpenAI", title: "Structured Output", level: "Beginner", interactive: false, sortOrder: 2 },
    { id: "azureopenai-lab03", number: "03", track: "Azure OpenAI", title: "Function Tools", level: "Intermediate", interactive: false, sortOrder: 3 },
  ],
};

/** Logs in as admin and returns the Cookie header to send on admin routes. */
export async function adminCookie(): Promise<Record<string, string>> {
  const response = await login(json("POST", "/api/admin/login", { password: "admin-secret" }));
  if (response.status !== 204) {
    throw new Error(`login failed: ${response.status} ${await response.text()}`);
  }
  const setCookie = response.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";")[0];
  return { cookie };
}
