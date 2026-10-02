---
title: Admin Dashboard and Progress Tracking API
status: implemented
priority: high
author: PM Agent
created: 2026-10-02
updated: 2026-10-02
jira_project: none
jira_epic: none
---

# Admin Dashboard and Progress Tracking API

## Summary

Developers do the labs with the **Lab Bench** dashboard that runs on their own machine (`Dashboard/LabDashboard`, ASP.NET Core, `127.0.0.1:5057`). Today nobody else can see what they do. This feature adds a second application, the **Admin Dashboard**: a new, independent **Next.js** app hosted on the web, that shows every developer, their progress lab by lab, their current state, and who is asking for help. It exposes a **public ingestion API** that each local dashboard calls to report its identity, the runs it starts and finishes, its progress, its heartbeats and its help requests. The local dashboard gets a first-launch **username** step, a persistent identity (`userId` + `username`), a reporting client that never blocks a run, and a **"Help / Je suis bloqué"** button whose status (open → acknowledged → resolved) is shown back to the developer. The admin refreshes itself every few seconds (near real time) and lets the trainer acknowledge and resolve help requests.

## Problem Statement

- The trainer runs workshops where several developers go through the labs at their own pace. The only feedback today is verbal or over chat: there is no central view of who is on which lab, who is stuck, who finished.
- The local dashboard already knows everything useful (lab opened, run started, build failed, checks passed, time spent) but keeps it in a local, git-ignored `history.json`.
- A developer who is stuck has no lightweight way to raise a hand that the trainer can see, triage and close.
- Without this feature, the trainer polls each developer, misses blocked people, and cannot adapt the session (pace, which lab needs an explanation) from facts.

## Goals

- [x] A trainer opens one web URL and sees, within 5 seconds of the event, every developer with their username, state (online / running / needs help / idle / offline), global progress (x / n labs completed), current lab and last activity.
- [x] For each developer, the trainer sees each lab as not started / in progress / completed (plus last result and run count), and the chronological activity feed.
- [x] A developer clicks **Help / Je suis bloqué** in the local dashboard; the request appears on the admin within 5 seconds, the trainer acknowledges and resolves it, and the developer sees each status change in their own dashboard.
- [x] The local dashboard works exactly as today when the admin server is unreachable or not configured: no run is delayed, failed or lost because of reporting.
- [x] Adding a new event type, a new lab or a new tracked field requires no change to stored data of existing developers and no breaking change of the API.

## Non-Goals

- No remote control: the admin never starts, cancels or sends input to a developer's run, and never reads their source files, API key or settings.
- No chat / messaging between trainer and developer (the help request carries one optional short message only).
- No real personal data: no e-mail, no real name required, no SSO for developers.
- No hosting of the local dashboard; it stays a local tool run with `dotnet run`.
- No multi-workshop / multi-cohort tenancy in v1 (one deployment = one cohort; see Future Considerations).
- No live streaming of a developer's console output to the admin (only run outcomes and summaries are reported).
- No change to any lab source file or to the way labs run from the CLI.

## Changelog

- **v1.0** (2026-10-02) — Initial release. Tasks T1..T15, no Jira (tracked in this file only).
- **v1.1** (2026-10-02) — Storage decided: MongoDB Atlas instead of Postgres/Prisma (Q2 closed). Data Model rewritten as collections, T2 reworded.
- **v1.3** (2026-10-02) — The admin app is isolated in its own repository: this spec moved with it (`specs/` of the AdminDashboard repository) and remains the API contract for both sides; the labs repository keeps a short pointer spec for its local-dashboard part (T12–T14).
- **v1.2** (2026-10-02) — Implemented (T1–T15, except the Vercel/Atlas deployment itself, left to the user). Deviations recorded during implementation: event `type` pattern relaxed to `^[a-z]+(\.[a-z]+)*$` (the strict form rejected `heartbeat`); `GET /api/v1/devs/me` also returns `lastHelpRequest` (closed request with its note) and `archived`; the server also writes `help.resolved` to the feed; `settings.changed` and unknown types update `lastSeenAt` only; events of one batch get `receivedAt` offset by their index so the feed keeps batch order; rate-limit and login-throttle counters are per instance; a help request clicked while the admin is down is kept in memory only until it is sent; a 400 on a batch drops the offending event instead of retrying forever; standalone MongoDB (no replica set) falls back to non-transactional apply with a warning.

---

## Reference

### Architecture

```
 Developer machine (one per developer)                         Internet            Hosted (Vercel)
 ┌──────────────────────────────────────────────┐                                 ┌──────────────────────────────────────┐
 │ Browser ──fetch/SSE──► LabDashboard (.NET)   │                                 │ AdminDashboard (Next.js, App Router) │
 │                        127.0.0.1:5057        │   HTTPS, server-to-server       │                                      │
 │   ├─ LabRunner (runs the labs)               │ ───── POST /api/v1/... ───────► │  ├─ Public ingestion API  /api/v1/*  │
 │   ├─ RunHistoryStore (history.json)          │       (dev token + workshop key)│  ├─ Admin UI (pages)   /, /devs/[id] │
 │   ├─ IdentityStore (identity.json)   NEW     │ ◄──── GET /api/v1/devs/me ───── │  ├─ Admin API (session) /api/admin/* │
 │   └─ ReportingClient (outbox.json)   NEW     │                                 │  └─ mongodb driver ──► MongoDB Atlas │
 └──────────────────────────────────────────────┘                                 └──────────────────────────────────────┘
                                                                                     ▲ polling every 3 s (TanStack Query)
                                                                                   Trainer's browser (password session)
```

Key choices (each one is also listed under Open Questions when it needs the user's confirmation):

| Topic | Choice |
|---|---|
| Admin app | New Next.js (App Router, TypeScript, React 19) application, **its own repository** (`AdminDashboard`, initially a folder of the labs repository, isolated on 2026-10-02). Only this app is deployed. |
| Hosting | Vercel (the repository root is the Next.js project). |
| Database | **MongoDB Atlas** (free M0 tier is enough for a cohort), official `mongodb` Node driver with one client cached across serverless invocations, documents validated with zod at the API boundary. No schema migrations: indexes are declared in code and ensured at startup. Local development uses a MongoDB container (`docker compose`, same image as Lab05). |
| Who talks to the API | The **.NET server** of the local dashboard, never the browser. No CORS, and the workshop key / dev token never reach a web page. |
| Near real time | Admin pages poll with TanStack Query (`refetchInterval` 3 s on the overview and help queue, 5 s on detail pages). Local dashboard polls its own help status every 10 s while a request is active. SSE fed by a MongoDB change stream is the documented upgrade path, not v1. |
| Identity | `userId` is a UUID v4 generated by the **local dashboard** on first launch and registered to the server; the server returns a secret **dev token** stored locally and sent as `Authorization: Bearer` on every call. |
| Catalog | The local dashboard pushes its lab catalog (id, number, track, title, level, order) at startup; the server upserts a `labs` collection. The admin needs no copy of `labs.json`. |
| Extensibility | One generic event envelope (`type`, `occurredAt`, `payload`) stored verbatim in an append-only `events` collection, plus projections (`devs.progress`, `runs`, `helpRequests`) rebuilt from known types. Unknown types are stored and shown in the feed, never rejected. New fields need no migration. |

### Responsibilities

| | Local dashboard (`Dashboard/LabDashboard` in the labs repository, .NET) | Admin dashboard (this repository, Next.js) |
|---|---|---|
| Runs the labs | Yes (unchanged) | Never |
| Owns the identity | Creates `userId`, asks the `username`, stores `identity.json`, sends both on every request | Stores the pair, issues and verifies the dev token |
| Source of truth for progress | Local `history.json` (unchanged) | Projection of reported events; can be resynchronised from a full snapshot at any time |
| Help request | Button, optional message, shows status, can cancel ("I'm unblocked") | Queue, acknowledge, resolve, note |
| Availability | Must work fully offline / without server | Must tolerate late, duplicate, out-of-order events |
| Users | One developer | The trainer (admin password) |

### Data Model

New Next.js app, new MongoDB database (`labs-admin`). Five collections; documents are described as TypeScript shapes (validated with zod on write). `_id` values are chosen by the client where idempotency matters.

```ts
// devs — one document per developer; the lab progression is EMBEDDED so the overview is one query.
type ProgressState = "notStarted" | "inProgress" | "completed";
type RunTarget = "start" | "solution";
type RunStatus = "running" | "passed" | "failed" | "cancelled" | "timedOut";

interface DevDoc {
  _id: string;                         // userId: UUID v4 chosen by the local dashboard
  username: string;                    // display name, not unique, last write wins
  tokenHash: string;                   // SHA-256 of the dev token; the token itself is never stored
  dashboardVersion?: string;
  platform?: "macOS" | "Windows" | "Linux" | string;
  createdAt: Date;
  lastSeenAt: Date;                    // last heartbeat or any accepted request
  lastActivityAt: Date;                // last meaningful event (not heartbeat)
  lastActivityType?: string;           // e.g. "run.finished"
  lastActivityLab?: string;
  archivedAt?: Date | null;            // hidden from the overview by the trainer
  catalogLabIds: string[];             // labs declared by this dev's last catalog.synced (denominator of the progress)
  progress: Record<string, LabProgress>; // keyed by labId
}

interface LabProgress {
  state: ProgressState;
  activeRunId?: string | null;         // a run is in progress right now
  runCount: number;                    // Start runs only
  solutionRunCount: number;
  firstRunAt?: Date;
  lastRunAt?: Date;
  lastRunStatus?: RunStatus;
  lastRunTarget?: RunTarget;
  completedAt?: Date;                  // first Start run that passed every check (sticky)
  solutionViewedAt?: Date;             // "try it first" gate crossed
  totalTokens: number;                 // sum of reported totals, Start runs
  updatedAt: Date;
}

// labs — catalog as reported by the local dashboards (union of what they declare)
interface LabDoc {
  _id: string;                         // "azureopenai-lab01"
  number: string; track: string; title: string; level: string;
  interactive: boolean;
  sortOrder: number;
  firstSeenAt: Date; updatedAt: Date;
}

// runs — one document per runId, updated when the run finishes
interface RunDoc {
  _id: string;                         // runId of the local dashboard
  devId: string; labId: string;
  target: RunTarget; status: RunStatus;
  failureStage?: "build" | "run" | "checks" | "input" | "dashboard";
  summary?: string;
  startedAt: Date; finishedAt?: Date; durationMs?: number;
  checksPassed?: number; checksTotal?: number;
  totalTokens?: number;
}

// helpRequests
type HelpStatus = "open" | "acknowledged" | "resolved" | "cancelled";
interface HelpRequestDoc {
  _id: string;                         // UUID generated by the server
  devId: string;
  labId?: string;                      // lab selected when the button was clicked
  message?: string;                    // ≤ 500 chars
  status: HelpStatus;
  createdAt: Date; acknowledgedAt?: Date; closedAt?: Date;
  closedBy?: "admin" | "dev";
  adminNote?: string;                  // ≤ 500 chars
}

// events — append-only log of every accepted event (audit, feed, replay of projections)
interface EventDoc {
  _id: string;                         // eventId chosen by the client (UUID) → idempotency (duplicate insert = ignored)
  devId: string;
  type: string;                        // see Event Types
  labId?: string;
  occurredAt: Date;                    // client clock
  receivedAt: Date;                    // server clock, used for ordering in the feed
  payload: unknown;                    // stored verbatim, ≤ 32 KB
}
```

Indexes (ensured at startup by an idempotent `ensureIndexes()`; a startup check logs any missing index):

| Collection | Index | Purpose |
|---|---|---|
| `devs` | `{ archivedAt: 1, lastActivityAt: -1 }` | overview and matrix |
| `devs` | `{ catalogLabIds: 1 }` | labs declared by at least one dev (matrix columns) |
| `runs` | `{ devId: 1, startedAt: -1 }` | detail page |
| `helpRequests` | `{ status: 1, createdAt: 1 }` | queue |
| `helpRequests` | `{ devId: 1, createdAt: -1 }` | detail page |
| `helpRequests` | `{ devId: 1 }` **partial unique** on `status ∈ {open, acknowledged}` | enforces Business Rule 9 at the database level |
| `events` | `{ devId: 1, receivedAt: -1 }`, `{ receivedAt: -1 }`, `{ type: 1, receivedAt: -1 }` | feed and filters |

Write pattern: projections are updated with single-document atomic operators (`$set`, `$inc`, `$max`, `$setOnInsert`) so concurrent batches for the same dev never lose updates; the whole batch runs inside one multi-document transaction (Atlas replica set) so a batch is all-or-nothing (Business Rule 6). Idempotency comes from the unique `_id` of `events`: a duplicate insert skips the apply step for that event and counts it as `ignored`.

Local dashboard, two new git-ignored files in `Dashboard/.data/` (next to `history.json`):

```jsonc
// identity.json — created at first launch, private to the user (600)
{ "userId": "5f0c…", "username": "john-dev", "devToken": "…", "registeredAt": "2026-10-02T09:12:00Z", "serverUrl": "https://labs-admin.example.com" }

// outbox.json — events not yet acknowledged by the server (ordered, max 500, oldest dropped with a log line)
[ { "eventId": "…", "type": "run.started", "occurredAt": "…", "labId": "azureopenai-lab03", "payload": { … } } ]
```

Local dashboard configuration (`appsettings.json` section `Dashboard:Reporting`, overridable by user secrets / `Dashboard__Reporting__*` environment variables):

```jsonc
"Reporting": {
  "ServerUrl": "",                 // empty = reporting disabled, dashboard behaves exactly as today
  "WorkshopKey": "",               // distributed by the trainer; stored in user secrets, never in git
  "HeartbeatSeconds": 60,
  "FlushIntervalSeconds": 5,
  "RequestTimeoutSeconds": 10
}
```

### Event Types

Every event is sent in the same envelope (see API). `payload` is specific to the type. The server stores every event verbatim and updates the projections for the types it knows.

| Type | When the local dashboard sends it | Payload | Projection |
|---|---|---|---|
| `catalog.synced` | At startup and whenever `labs.json` is reloaded | `{ labs: [{ id, number, track, title, level, interactive, sortOrder }] }` | Upsert `labs` documents; set `catalogLabIds`; create missing `progress` entries (notStarted) for this dev |
| `progress.snapshot` | At startup (after registration) and after every finished run | `{ labs: [{ labId, state, runCount, solutionRunCount, lastRunAt, lastRunStatus, lastRunTarget, completedAt, firstRunAt, totalTokens }] }` computed from local `history.json` | Overwrite `devs.progress` of this dev (full resync, self-healing after lost events) |
| `lab.opened` | The developer opens a lab page (debounced: once per lab per 5 min) | `{ }` + `labId` | `lastActivity*` |
| `run.started` | A run is accepted by the runner | `{ runId, target }` + `labId` | Insert `runs` document (running); `LabProgress.activeRunId`, state → IN_PROGRESS if NOT_STARTED and target = start; `lastActivity*` |
| `run.finished` | The run record is written to history | `{ runId, target, status, failureStage, summary, durationMs, buildDurationMs, runDurationMs, exitCode, checks: [{ id, passed }], totalTokens }` + `labId` | Update `runs` document; `devs.progress` (counters, lastRun*, completedAt when target = start and status = passed, totalTokens); clear `activeRunId`; `lastActivity*` |
| `solution.viewed` | The "try it first" gate is crossed | `{ }` + `labId` | `LabProgress.solutionViewedAt`; `lastActivity*` |
| `heartbeat` | Every `HeartbeatSeconds` while the local dashboard process runs | `{ browserConnected: bool, activeRunId: string? }` | `Dev.lastSeenAt` only (never `lastActivityAt`) |
| `settings.changed` | Azure OpenAI settings saved (no values) | `{ authMode: "apiKey" \| "entraId" \| "notConfigured" }` | Feed only |
| `help.requested` / `help.cancelled` | Not sent as events: help uses its own endpoints, but the server **writes** a matching `events` document itself so the feed is complete | — | — |

Rules for new types: a type is `<subject>.<verb>` in lower case; the server accepts any type matching `^[a-z]+(\.[a-z]+)*$`; unknown types are stored, counted and shown in the feed as "Other event".

### Derived States

**Exercise (one lab for one developer)** — stored `state` plus two derived flags shown in the UI:

| Displayed | Condition |
|---|---|
| Not started | `state = NOT_STARTED` |
| In progress | `state = IN_PROGRESS` and no `activeRunId` |
| Running now | `activeRunId` set and the dev's `lastSeenAt` < 3 min (otherwise shown as In progress with a "stale run" hint) |
| Completed | `state = COMPLETED` (sticky: later failed runs do not revert it) |
| + Blocked badge | an OPEN / ACKNOWLEDGED help request references this `labId` |
| + Last result | `lastRunStatus` (Passed / Failed (build \| run \| checks) / Cancelled / Timed out) |

**Help request**: `OPEN` (demande active) → `ACKNOWLEDGED` (prise en compte) → `RESOLVED` (résolue). `OPEN` → `RESOLVED` directly is allowed. `OPEN` / `ACKNOWLEDGED` → `CANCELLED` by the developer only ("I'm unblocked"). `RESOLVED` and `CANCELLED` are terminal and immutable.

**Developer state** (first matching row wins):

| State | Condition |
|---|---|
| Needs help | has a help request OPEN or ACKNOWLEDGED |
| Running | any `LabProgress.activeRunId` set and `lastSeenAt` < 3 min |
| Online | `lastSeenAt` < 3 min |
| Idle | `lastSeenAt` < 30 min |
| Offline | otherwise |

**Global progress**: `completed / total labs known for this dev` (labs declared in the dev's last `catalog.synced`), shown as a fraction and a bar.

### Business Rules

1. **Identity is client-generated and stable.** `userId` is a UUID v4 created once by the local dashboard and persisted in `identity.json`. Deleting the file creates a new developer on the server; the admin can archive the old one.
2. **Every public API request carries `userId` and `username`** in the JSON body (or as the registration body). The server rejects a body whose `userId` differs from the one bound to the bearer token (403).
3. **Username is display-only, 2–32 characters, `[A-Za-z0-9._-]`, not unique.** The stored username is updated to the value received in each accepted request (rename from the local dashboard is enough). The admin UI always shows the first 8 characters of `userId` next to it to disambiguate.
4. **Registration is idempotent.** `POST /api/v1/devs/register` with a known `userId` and a valid dev token updates the username and returns 200 without a new token; with an unknown `userId` it creates the dev and returns 201 with a new token; with a known `userId` and no/invalid token it is rejected (403) so a copied id cannot hijack a developer.
5. **Two layers of protection on the public API.** The workshop key (`X-Workshop-Key`, one per deployment, env `WORKSHOP_KEY`) is required to register. The dev token (`Authorization: Bearer`) is required for every other call. Both are verified with constant-time comparison; only the token hash is stored.
6. **Events are idempotent and batched.** `eventId` is unique per event; a replayed event is acknowledged (`ignored`) and not re-applied. A batch holds 1–100 events, 256 KB max, applied in order inside one transaction per batch; one invalid event rejects the whole batch (400 with the index of the offending event) so the client never half-applies.
7. **Reporting never affects a run.** The local dashboard enqueues events in memory + `outbox.json` and flushes asynchronously with exponential backoff (5 s → 60 s, jitter). Failures are logged at Information level once per minute at most. Timeouts are 10 s. A run starts, streams and ends exactly as today whatever the server does.
8. **Snapshot is authoritative.** When `progress.snapshot` arrives, the server overwrites `devs.progress` counters for that dev from the snapshot, but keeps `COMPLETED` if either side says completed, and keeps `solutionViewedAt` / `activeRunId` when the snapshot does not carry them.
9. **At most one active help request per developer.** Creating a request while one is OPEN / ACKNOWLEDGED returns 409 with the existing request. The admin can acknowledge / resolve; the developer can cancel; a terminal request never changes.
10. **Help status is visible to the developer.** The local dashboard polls `GET /api/v1/devs/me` every 10 s while it has an active request and shows: *Help requested — waiting*, *Taken into account by the trainer*, *Resolved* (with the admin note if any), *Cancelled*.
11. **Ordering uses the server clock.** The feed and "last activity" are ordered by `receivedAt`; `occurredAt` is displayed as given by the client but never trusted for ordering (clock skew) and is clamped to `[receivedAt − 24 h, receivedAt + 5 min]`.
12. **Unknown labs are accepted.** An event for a `labId` absent from the `labs` collection creates a minimal `labs` document (`title = id`, `sortOrder = 999`) and is applied normally; the next `catalog.synced` fills it in.
13. **Admin area is private.** Every `/api/admin/*` route and every page except `/login` requires the admin session (httpOnly, Secure, SameSite=Lax cookie, 12 h, signed with `SESSION_SECRET`; password in env `ADMIN_PASSWORD`). Five failed logins per IP per 15 min → 429.
14. **No personal data.** The server never stores IP addresses in business tables, e-mail, machine name or source paths. `platform` and `dashboardVersion` are the only environment facts reported.
15. **Rate limits on the public API**: 120 requests / min per dev token, 30 registrations / min per IP; excess → 429 with `Retry-After`, which the client honours.
16. **Archiving is soft.** Archived devs are hidden from the overview and counters but kept in the database and still accepted by the API (reporting un-archives them).

### API

All routes are JSON, under `/api/v1` (public, consumed by local dashboards) or `/api/admin` (private, consumed by the admin pages). Errors use `{ "error": "<code>", "message": "<human text>", "details"?: {...} }`. Codes: `validation`, `unauthorized`, `forbidden`, `notFound`, `conflict`, `rateLimited`, `internal`.

**Public API** (headers: `Content-Type: application/json`; `X-Workshop-Key` on register; `Authorization: Bearer <devToken>` elsewhere)

| Method & route | Purpose | Body | Response |
|---|---|---|---|
| `POST /api/v1/devs/register` | Create or refresh the identity | `{ userId, username, dashboardVersion?, platform? }` | 201 `{ userId, username, devToken, serverTime }` (new) / 200 `{ userId, username, serverTime }` (known, token valid) / 403 known id without valid token |
| `POST /api/v1/events` | Report a batch of events | `{ userId, username, events: [{ eventId, type, occurredAt, labId?, payload }] }` | 202 `{ accepted: n, ignored: n, serverTime }` / 400 `{ error: "validation", details: { index, reason } }` |
| `POST /api/v1/help-requests` | Raise a hand | `{ userId, username, labId?, message? }` | 201 `{ id, status: "open", createdAt }` / 409 `{ error: "conflict", details: { existing: {...} } }` |
| `POST /api/v1/help-requests/{id}/cancel` | "I'm unblocked" | `{ userId, username }` | 200 `{ id, status: "cancelled" }` / 409 if terminal / 404 if not this dev's |
| `GET /api/v1/devs/me` | Sync back (help status, archived, server time) | — (`userId` from the token) | 200 `{ userId, username, archived, activeHelpRequest: HelpView \| null, lastHelpRequest: HelpView \| null, serverTime }` with `HelpView = { id, status, labId, createdAt, acknowledgedAt, closedAt, closedBy, adminNote? }` (`lastHelpRequest` lets the developer see the note of a request just resolved) |
| `GET /api/v1/health` | Reachability test for the local settings form | — | 200 `{ status: "ok", version }` (no auth) |

**Admin API** (admin session cookie; also used by the pages through TanStack Query)

| Method & route | Purpose | Response |
|---|---|---|
| `POST /api/admin/login` / `POST /api/admin/logout` | Session | 204 / 401 |
| `GET /api/admin/overview` | Everything the overview page needs in one call | `{ counters: { devs, online, running, needsHelp, completedLabs }, labs: [Lab], devs: [{ id, username, state, lastSeenAt, lastActivityAt, lastActivityType, lastActivityLab, completed, total, currentLab?, activeHelpRequestId? }] }` |
| `GET /api/admin/devs/{id}` | Detail page | `{ dev, progress: [LabProgress + lab], runs: [Run] (last 50), helpRequests: [..], events: [..] (last 100) }` |
| `GET /api/admin/matrix` | Labs × devs completion grid | `{ labs: [..], rows: [{ dev, cells: [{ labId, state, lastRunStatus, blocked }] }] }` |
| `GET /api/admin/help-requests?status=open,acknowledged` | Queue | `[{ id, dev: { id, username }, lab?, message, status, createdAt, acknowledgedAt }]` |
| `POST /api/admin/help-requests/{id}/acknowledge` / `.../resolve` | Transitions | 200 updated request / 409 if terminal; `resolve` accepts `{ adminNote? }` |
| `POST /api/admin/devs/{id}/archive` / `.../unarchive` | Hide / show a dev | 200 |
| `GET /api/admin/events?devId=&type=&cursor=` | Paginated feed (50 per page) | `{ items, nextCursor }` |

Every list is sorted deterministically (overview: needs help first, then running, online, idle, offline; inside a group by `lastActivityAt` desc).

### Flows

**First launch of the local dashboard** (reporting configured, no `identity.json`)

```
Browser opens 127.0.0.1:5057
  → page shows a blocking "Welcome" dialog: username field (+ server URL and workshop key fields when not preconfigured), "Start" button
  → POST /api/identity { username }           (local API, same CSRF rules as today)
  → LabDashboard generates userId (UUID v4), writes identity.json (without token yet)
  → POST <server>/api/v1/devs/register        (X-Workshop-Key)  → 201 { devToken }
  → identity.json updated with devToken; ReportingClient starts: catalog.synced, progress.snapshot, heartbeat timer
  → dialog closes; top bar shows "Reporting to <host> as john-dev" (green) or "Reporting: offline, retrying" (amber)
Server unreachable at step register → identity is kept locally, dialog closes, status amber, registration retried with backoff; events queue in the outbox.
```

**Run lifecycle**

```
POST /api/labs/{id}/runs (local)  → runner accepts → event run.started enqueued → flushed within 5 s → admin: lab "Running now", dev "Running"
run ends → RunHistoryStore.AddAsync → run.finished + progress.snapshot enqueued → admin: lab "Completed" / "In progress (Failed: checks)", counters updated
```

**Help request**

```
Click "Help / Je suis bloqué" (local) → optional message dialog (lab preselected) → POST /api/help (local)
  → POST <server>/api/v1/help-requests → 201 → local banner "Help requested — waiting for the trainer", button becomes "I'm unblocked"
  → admin: dev card turns to "Needs help" (top of the list), help queue badge + sound (optional, togglable)
Trainer clicks Acknowledge → ACKNOWLEDGED → local poll (10 s) shows "Taken into account"
Trainer clicks Resolve (+ note) → RESOLVED → local shows "Resolved: <note>" for 5 min, then the button is back to normal
Developer clicks "I'm unblocked" → CANCELLED → admin queue drops it, feed shows "help.cancelled"
```

**Offline / resync**

```
Server down: events accumulate in outbox.json (max 500) → server back → flushed in order, 100 per batch → duplicates ignored
Local dashboard restarts: progress.snapshot sent → server overwrites counters → admin consistent even if run events were lost
```

### Edge Cases

| Case | Expected behavior |
|---|---|
| Reporting not configured (`ServerUrl` empty) | No welcome dialog, no Help button, no network call; dashboard identical to today. |
| `identity.json` deleted by the developer | Welcome dialog again, new `userId`; the old dev stays on the admin until archived. |
| `identity.json` copied to a second machine | Both machines report as the same dev; last heartbeat wins; admin shows one dev. Documented, not prevented. |
| Username changed later (settings form) | Next request updates the stored username; history stays attached to the `userId`. |
| Username invalid (empty, 1 char, spaces, 40 chars) | Local validation blocks the dialog with a field error; server also validates (400). |
| Wrong workshop key | Register → 401; local status "Reporting: rejected (workshop key)" with a link to the settings; nothing else blocked. |
| Dev token revoked / dev deleted server-side | 401 on events → client re-registers once with the workshop key; if that fails, status amber, outbox kept. |
| Server returns 5xx or times out | Retry with backoff; outbox persisted; no UI blocking. |
| Outbox reaches 500 events | Oldest dropped, one warning log line; next `progress.snapshot` restores a consistent state. |
| Duplicate batch (client retried after a timeout) | 202 with `ignored = n`; projections unchanged. |
| `run.finished` arrives before `run.started` (reordered batches) | `runs` document upserted from the finished event; `activeRunId` never left dangling. |
| `run.started` without a matching `run.finished` for > 3 min of no heartbeat | Shown as "In progress (stale run)"; cleared by the next snapshot or heartbeat `activeRunId: null`. |
| Solution run passed, Start run never passed | Lab stays IN_PROGRESS; "Solution run passed" shown as a hint; completion counts Start runs only. |
| Help requested while one is active | 409; local dashboard shows the existing request instead. |
| Admin resolves and developer cancels at the same moment | First write wins (transaction on status); the second gets 409 and refreshes. |
| Help request on an archived dev | Accepted; dev un-archived and shown again. |
| Lab removed from `labs.json` later | Remains in the `labs` collection; the dev's total uses their last catalog; the matrix shows the column greyed if no dev declares it. |
| 50 developers, 10 labs | Overview call < 300 ms (one `devs` query with embedded progress + one `helpRequests` query); no pagination needed in v1. |
| Admin password not set in env | Admin pages show a configuration error page; public API still works. |
| Browser of the trainer loses network | TanStack Query keeps the last data, shows a "Disconnected since hh:mm" banner, resumes polling. |
| Event with unknown `type` | Stored, `accepted` incremented, shown as "Other event" in the feed. |
| Event with `occurredAt` 3 days in the past (laptop asleep) | Accepted; displayed with a "reported late" hint; ordered by `receivedAt`. |

### UI / UX

Admin dashboard (this repository), App Router routes:

| Page / View | Route | Purpose |
|---|---|---|
| Login | `/login` | Password field, error on failure, redirects to the page requested. |
| Overview | `/` | Counters strip (devs, online, running, needs help, labs completed today); banner listing OPEN help requests with Acknowledge / Resolve inline; cards of developers (username, short id, state pill, progress bar x/n, current lab, last activity "3 min ago"). Sorted needs-help first. Click → detail. |
| Matrix | `/matrix` | Table labs (columns, in catalog order) × devs (rows): cell colour = state, red outline = blocked, tooltip with last result and run count. Export CSV button. |
| Help queue | `/help` | Open and acknowledged requests, oldest first, with dev, lab, message, elapsed time; Acknowledge / Resolve (note dialog); history tab for closed ones. Optional sound alert toggle (stored in localStorage). |
| Developer detail | `/devs/[userId]` | Header (username, id, state, since, platform, dashboard version, archive button); labs list with state, last result, run counts, tokens, completion time; runs table (last 50); help requests; activity feed (paginated). |

Design: dark theme consistent with the local Lab Bench (same palette cues), responsive to tablet width (the trainer may use an iPad), keyboard navigable, state conveyed by text + colour (not colour alone). Every text in English and French with a top-bar `EN | FR` switch (same convention as the local dashboard); the local dashboard's new strings go in its existing `i18n.js`. Relative times update every 10 s. All data via TanStack Query with the global rules (key factory per domain, `initialData` from the server component, `placeholderData` on lists, `useMutation` throwing on error).

Local dashboard additions (`Dashboard/LabDashboard/wwwroot`): welcome dialog at first launch; top-bar reporting status pill (green / amber / red / hidden when disabled) with a tooltip giving the server host and username; **Help / Je suis bloqué** button in the top bar (and in the lab page header) that opens a small dialog (lab preselected, optional 500-char message, Send); once active the button shows the status and offers **I'm unblocked**; a settings entry to change username / server URL / workshop key (key write-only, like the Azure OpenAI key).

### User Stories

#### Story 1: Trainer sees the room at a glance
**As a** trainer, **I want to** open one page and see who is online, who is running a lab, who is stuck and how far everyone is, **So that** I can pace the session and go help the right person.

#### Story 2: Developer raises a hand
**As a** developer, **I want to** click a button when I am blocked and see that the trainer has seen it, **So that** I do not have to interrupt the room or wait without knowing.

#### Story 3: Trainer triages help
**As a** trainer, **I want to** acknowledge a request (so the developer knows I am coming) and resolve it with a short note, **So that** the queue stays clean and nobody is forgotten.

#### Story 4: Developer is never slowed down
**As a** developer, **I want** my local dashboard to work offline or when the server is down, **So that** reporting never gets in the way of the labs.

#### Story 5: Trainer reviews one developer
**As a** trainer, **I want to** open a developer and see lab by lab what happened (failed builds, failed checks, time, tokens), **So that** I can debrief with facts.

#### Story 6: Trainer onboards a developer
**As a** trainer, **I want** a developer to set a username once and be identified from then on, **So that** onboarding takes a minute and needs no account.

---

## Tasks

> Each block below becomes ONE Jira Task. The Epic is created from the spec header.

### T1 — [config] Admin app skeleton deployed and reachable

**Jira**: none
**Agent hint**: frontend-mobile-development:frontend-developer
**Depends on**: —

**User outcome**: The trainer can open the admin URL (preview and production) and get a placeholder page; `GET /api/v1/health` answers from the hosted app. The repository has a new `AdminDashboard/` application with lint, type-check and unit test commands documented in its README.

**Business constraints**:
- New independent Next.js (App Router, TypeScript) application; nothing of the local dashboard is imported or modified.
- Hosting on Vercel from the repository root; environment variables documented (`MONGODB_URI`, `MONGODB_DB`, `WORKSHOP_KEY`, `ADMIN_PASSWORD`, `SESSION_SECRET`).
- TanStack Query provider and query-key factory conventions from the global rules are set up from the start.

**Success criteria**:
- [ ] Opening the deployed URL shows the app (placeholder) over HTTPS.
- [ ] `GET <url>/api/v1/health` returns 200 with `{ status: "ok", version }`.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` run green locally and in the Vercel build.

**References**: Architecture, Story 6

---

### T2 — [db] MongoDB collections, indexes and local database

**Jira**: none
**Agent hint**: database-design:database-architect
**Depends on**: T1

**User outcome**: The hosted app is connected to its MongoDB Atlas database and a contributor gets a local MongoDB with one command; the collections, their validation and their indexes exist on both, created by the application itself at startup, so nothing has to be run by hand when deploying.

**Business constraints**:
- Collections, shapes and indexes as in Reference → Data Model, including the partial unique index that enforces one active help request per developer.
- One MongoDB client cached across serverless invocations (never one connection per request); `MONGODB_URI` for Atlas in production and for the local container in development.
- The seed never runs against a database whose name is not the development one.

**Success criteria**:
- [ ] After a fresh deploy, the Atlas database shows the five collections and every index of the Data Model table, with no manual step.
- [ ] `docker compose up -d` at the repository root plus the seed command gives a local database with 3 sample devs, 10 labs, a few runs and one open help request.
- [ ] Inserting a second `events` document with an existing `_id`, or a second open help request for the same dev, fails at the database level.
- [ ] The health endpoint reports the database as reachable (`db: "ok"`) and returns 503 with `db: "unreachable"` when it is not.

**References**: Data Model, Business Rules 6, 9, 12

---

### T3 — [security] Public API protection: workshop key, dev token, rate limits, validation

**Jira**: none
**Agent hint**: backend-api-security:backend-security-coder
**Depends on**: T2

**User outcome**: A caller without the workshop key cannot register; a caller without a valid dev token cannot report events; a token bound to one `userId` cannot report for another; floods are throttled with a clear `429` and `Retry-After`; malformed bodies get a precise `400`.

**Business constraints**:
- Business Rules 2, 3, 5, 14, 15. Constant-time comparison; only the token hash stored; token is 32 random bytes, base64url.
- Every public route validates its body against a schema; unknown fields are ignored, `payload` is free JSON up to 32 KB per event, batch 256 KB.
- No IP or user agent stored in business tables (rate-limit counters may live in memory or a cache with a TTL).

**Success criteria**:
- [ ] `POST /api/v1/devs/register` without `X-Workshop-Key` (or a wrong one) returns 401; with the key it returns 201 and a token.
- [ ] `POST /api/v1/events` with no token → 401; with a token of dev A and `userId` of dev B → 403.
- [ ] 121 event requests in one minute with one token → the 121st returns 429 with `Retry-After`.
- [ ] A body with `username` of 1 character, or an event `type` not matching `^[a-z]+(\.[a-z]+)*$`, returns 400 with the field / event index in `details`.

**References**: Business Rules 2–5, 14, 15, Edge Cases ("wrong workshop key", "dev token revoked")

---

### T4 — [backend] Developer registration endpoint

**Jira**: none
**Agent hint**: backend-development:backend-architect
**Depends on**: T3

**User outcome**: A local dashboard registers a developer once and gets a token; re-registering with the same id and token refreshes the username and returns no new token; re-registering a known id without the token is refused. The developer appears on the admin as soon as registered.

**Business constraints**:
- Business Rules 1, 3, 4, 16 (reporting un-archives).
- `platform` and `dashboardVersion` are optional, stored as given (max 64 chars).

**Success criteria**:
- [ ] First registration → 201 with `devToken`; a `devs` document exists with `lastSeenAt = now`.
- [ ] Same `userId`, valid token, new username → 200, username updated, no token in the response.
- [ ] Same `userId`, no token → 403; same `userId`, wrong token → 403.
- [ ] Registering an archived dev clears `archivedAt`.

**References**: Business Rules 1, 3, 4, 16, Edge Cases ("identity.json deleted", "username changed"), Story 6

---

### T5 — [backend] Event ingestion and progress projection

**Jira**: none
**Agent hint**: backend-development:backend-architect
**Depends on**: T4

**User outcome**: Everything a local dashboard reports (catalog, snapshot, lab opened, run started / finished, solution viewed, heartbeat, unknown types) is stored and immediately reflected in the developer's progress, runs, last activity and online state, even when batches are late, duplicated or out of order.

**Business constraints**:
- Event Types table, Derived States, Business Rules 6, 7 (server side: idempotency), 8, 11, 12.
- One transaction per batch; a batch is all-or-nothing.
- Heartbeat updates `lastSeenAt` only; a heartbeat with `activeRunId: null` clears a dangling `activeRunId`.

**Success criteria**:
- [ ] Sending `catalog.synced` then `progress.snapshot` for a new dev → the dev shows every lab with the snapshot state; sending the same batch again → `ignored` equals the batch size and nothing changes.
- [ ] `run.started` (start) on a NOT_STARTED lab → IN_PROGRESS with an active run; `run.finished` passed → COMPLETED with `completedAt`; a later `run.finished` failed keeps COMPLETED and updates `lastRunStatus`.
- [ ] A batch with `run.finished` before `run.started` for the same run ends with one `runs` document, status from the finished event, no active run.
- [ ] A `run.finished` with `target: solution` increments `solutionRunCount` only and never completes the lab.
- [ ] An event with an unknown type is accepted and visible in `GET /api/admin/events` as "Other event"; an event for an unknown `labId` creates the lab.

**References**: Event Types, Derived States, Business Rules 6, 8, 11, 12, Edge Cases ("duplicate batch", "reordered", "stale run", "solution run passed"), Story 1, Story 5

---

### T6 — [backend] Help request endpoints (developer side) and sync-back

**Jira**: none
**Agent hint**: backend-development:backend-architect
**Depends on**: T4

**User outcome**: A developer can raise one help request at a time with an optional message and lab, cancel it when unblocked, and read its current status (open / acknowledged / resolved with note / cancelled) from the server.

**Business constraints**:
- Business Rules 9, 10; help status machine in Derived States; terminal states immutable.
- The server writes an `events` document (`help.requested`, `help.cancelled`) so the feed is complete.
- `GET /api/v1/devs/me` is cheap (two indexed queries) because it is polled every 10 s per developer.

**Success criteria**:
- [ ] `POST /api/v1/help-requests` → 201 OPEN; a second one while the first is OPEN → 409 carrying the first.
- [ ] `POST .../{id}/cancel` on an OPEN or ACKNOWLEDGED request → 200 CANCELLED with `closedBy: dev`; on a RESOLVED one → 409; on another dev's request → 404.
- [ ] `GET /api/v1/devs/me` returns the active request with its status and `adminNote` once resolved, and `null` when none is active.
- [ ] A help request on an archived dev un-archives them.

**References**: Business Rules 9, 10, 16, Edge Cases ("help requested while one is active", "same moment"), Story 2

---

### T7 — [security] Admin login and session

**Jira**: none
**Agent hint**: backend-api-security:backend-security-coder
**Depends on**: T1

**User outcome**: The trainer signs in with the admin password on `/login` and stays signed in for 12 hours; any admin page or admin API without a session redirects to login / returns 401; a wrong password five times in 15 minutes is throttled. Logout works.

**Business constraints**:
- Business Rule 13. Password compared in constant time; cookie httpOnly, Secure, SameSite=Lax, signed.
- Public API routes are never affected by the session middleware.
- A missing `ADMIN_PASSWORD` or `SESSION_SECRET` shows a configuration error page instead of allowing access.

**Success criteria**:
- [ ] Opening `/` without a session redirects to `/login?next=/`; after login the trainer lands on `/`.
- [ ] `GET /api/admin/overview` without the cookie → 401; with it → 200.
- [ ] Five wrong passwords → the sixth attempt returns 429 even with the right password; after 15 min it works.
- [ ] Logout clears the cookie and `/` redirects to `/login` again.

**References**: Business Rule 13, Edge Cases ("admin password not set")

---

### T8 — [frontend] Overview page with live developer cards and counters

**Jira**: none
**Agent hint**: frontend-mobile-development:frontend-developer
**Depends on**: T5, T6, T7

**User outcome**: The trainer sees every developer as a card (username, short id, state pill, progress bar, current lab, last activity), counters at the top and a banner of open help requests with inline Acknowledge / Resolve; the page refreshes itself every 3 seconds without flicker and shows a "disconnected" notice when the server is unreachable.

**Business constraints**:
- Derived States (dev state precedence and ordering), Business Rule 16 (archived hidden).
- Data via `GET /api/admin/overview` with TanStack Query (`refetchInterval` 3 s, `initialData` from the server component).
- Help actions in the banner reuse the admin transition endpoints delivered in T10 (or the page delivers them if T10 is not yet done).
- EN / FR texts; dark theme; tablet-width layout.

**Success criteria**:
- [ ] A developer who registered 10 s ago appears on the page without reload, state "Online".
- [ ] When a developer starts a run, their card shows "Running" and the lab title within 5 s; when the run passes, the progress fraction increments.
- [ ] A dev with an open help request moves to the top with a "Needs help" pill and appears in the banner; clicking Acknowledge changes the pill text within one refresh.
- [ ] A developer whose last heartbeat is 4 min old shows "Idle"; 31 min old shows "Offline".
- [ ] Switching to FR translates every label of the page.

**References**: Derived States, UI / UX (Overview), Story 1, Story 3

---

### T9 — [frontend] Developer detail page with labs, runs, help history and activity feed

**Jira**: none
**Agent hint**: frontend-mobile-development:frontend-developer
**Depends on**: T5, T6, T7

**User outcome**: Clicking a developer opens a page listing each lab with its state, last result (with failure stage), run counts, tokens and completion time; the last 50 runs; the help requests with their notes; and a paginated activity feed. The trainer can archive / unarchive the developer from here.

**Business constraints**:
- Derived States (exercise display incl. "stale run", "blocked", "solution run passed" hint).
- Refresh every 5 s with TanStack Query; feed pagination by cursor.
- Archive is a mutation that invalidates the overview and detail queries.

**Success criteria**:
- [ ] A lab whose last Start run failed at the checks shows "In progress · Failed (checks) · 3 runs"; a completed lab shows the completion time and stays "Completed" after a later failed run.
- [ ] A run in progress shows "Running now"; if the dev stops sending heartbeats for 3 min it shows "In progress (stale run)".
- [ ] The feed shows events newest first, including "Other event" rows for unknown types and the help requested / cancelled entries; "Load more" fetches the next page.
- [ ] Archive hides the dev from the overview; Unarchive brings them back.

**References**: Derived States, Event Types, UI / UX (Developer detail), Story 5

---

### T10 — [frontend] Help queue page and admin transitions

**Jira**: none
**Agent hint**: frontend-mobile-development:frontend-developer
**Depends on**: T6, T7

**User outcome**: The trainer has a dedicated queue of open and acknowledged requests (oldest first, elapsed time, dev, lab, message) with Acknowledge and Resolve (note dialog) actions, a history tab of closed requests, and an optional sound alert when a new request arrives.

**Business constraints**:
- Delivers the admin transition endpoints (`acknowledge`, `resolve` with note) following the help status machine; terminal requests return 409 and the UI refreshes.
- Refresh every 3 s; sound preference stored per browser; the resolve note is ≤ 500 chars.
- Mutations throw on failure and invalidate the help, overview and dev-detail queries.

**Success criteria**:
- [ ] A new request appears in the queue within 5 s with "2 min ago"-style elapsed time; with sound enabled, a short sound plays once per new request.
- [ ] Acknowledge moves it to the "acknowledged" style; Resolve with a note moves it to the history tab with the note visible.
- [ ] Resolving a request the developer cancelled a moment earlier shows an "already closed" message and the list refreshes.
- [ ] The developer's local dashboard (T13) reflects each transition within 10 s.

**References**: Derived States (help), Business Rule 9, UI / UX (Help queue), Story 3

---

### T11 — [frontend] Labs × developers matrix with CSV export

**Jira**: none
**Agent hint**: frontend-mobile-development:frontend-developer
**Depends on**: T5, T7

**User outcome**: The trainer sees a grid with labs as columns (catalog order) and developers as rows, each cell coloured by state with a red outline when blocked and a tooltip with the last result and run count; a button downloads the grid as CSV.

**Business constraints**:
- Derived States; archived devs excluded; labs no dev declares are greyed.
- State conveyed by text/icon as well as colour.

**Success criteria**:
- [ ] The grid shows every lab from the union of catalogs and every non-archived dev; cells update within 5 s of a run finishing.
- [ ] Hovering a cell shows "Failed (build) · 2 runs"; a blocked lab has the red outline and a "blocked" icon.
- [ ] The CSV contains one row per dev and one column per lab with the state names, opening correctly in Excel.

**References**: Derived States, UI / UX (Matrix), Story 1

---

### T12 — [backend] Local dashboard: identity setup and registration

**Jira**: none
**Agent hint**: backend-development:backend-architect
**Depends on**: T4

**User outcome**: The first time a developer opens the local dashboard with reporting configured, a welcome dialog asks for a username (and the server URL / workshop key if not preconfigured); from then on the dashboard remembers the identity, registers it with the server and shows a reporting status pill in the top bar. The developer can change the username, server URL or workshop key in the settings.

**Business constraints**:
- Business Rules 1, 3, 7; Data Model (identity.json, Reporting settings); Edge Cases ("reporting not configured", "wrong workshop key", "identity.json deleted").
- Local API additions follow the existing protections (loopback, Host check, `X-Lab-Dashboard`, same-origin) and the workshop key is write-only like the Azure OpenAI key.
- With `ServerUrl` empty nothing changes for the developer; all existing dashboard tests keep passing.

**Success criteria**:
- [ ] With reporting configured and no identity file, opening the dashboard shows the welcome dialog; entering `john-dev` closes it and the top bar shows "Reporting to <host> as john-dev".
- [ ] The identity file exists with `userId`, `username` and `devToken`, private to the user, and the dev appears on the admin.
- [ ] Restarting the dashboard shows no dialog and the same `userId` is reused.
- [ ] A wrong workshop key shows the red status with the reason; the labs still run normally.
- [ ] With `ServerUrl` empty: no dialog, no status pill, no Help button, no network call.

**References**: Business Rules 1, 3, 4, 7, Data Model, Edge Cases, Story 6, Story 4

---

### T13 — [backend] Local dashboard: reporting client (events, snapshot, heartbeat, outbox)

**Jira**: none
**Agent hint**: backend-development:backend-architect
**Depends on**: T5, T12

**User outcome**: Everything the developer does in the local dashboard (catalog, lab opened, run started / finished, solution viewed, settings auth mode, heartbeat) reaches the admin within 5 seconds when the server is up, is queued and delivered later when it is down, and never delays or fails a run.

**Business constraints**:
- Event Types (payloads exactly as specified), Business Rule 7 (async, backoff, outbox cap, logging), Rule 6 (eventId per event, batches ≤ 100), Rule 15 (honour `Retry-After`), Edge Cases ("server returns 5xx", "outbox reaches 500", "dev token revoked" → one re-registration).
- `progress.snapshot` computed from the existing run history with the same completion rule as the local UI (a passed Start run).
- Reporting runs in the .NET process (no browser involvement); runs are unaffected even if the server hangs for the full request timeout.

**Success criteria**:
- [ ] Starting a run makes the admin show "Running" within 5 s; finishing it updates the state and run counters.
- [ ] Stop the admin server, run two labs, restart it: the admin shows both runs and the right states within 10 s of restart; nothing was lost or duplicated.
- [ ] While the server is down, a run of Lab01 takes the same time (± 1 s) as with the server up, and ends with the same verdict.
- [ ] Restarting the local dashboard sends a snapshot that corrects a deliberately wrong state on the server.
- [ ] The admin's "last seen" of the dev advances every minute while the local dashboard runs, and stops when it is closed.

**References**: Event Types, Business Rules 6, 7, 8, 15, Edge Cases, Story 4

---

### T14 — [frontend] Local dashboard: Help / Je suis bloqué button and status feedback

**Jira**: none
**Agent hint**: frontend-mobile-development:frontend-developer
**Depends on**: T6, T12

**User outcome**: The developer clicks **Help / Je suis bloqué** in the top bar (or on the lab page), optionally types a message, and sees a banner "Help requested — waiting for the trainer"; it changes to "Taken into account" and then "Resolved: <note>" as the trainer acts, and an **I'm unblocked** button cancels the request.

**Business constraints**:
- Business Rules 9, 10; the dialog preselects the currently open lab; message ≤ 500 chars.
- Local API additions keep the existing protections; status polled every 10 s only while a request is active.
- EN / FR texts in the existing dictionary; keyboard accessible; status announced to screen readers.

**Success criteria**:
- [ ] Clicking the button and sending creates the request (visible on the admin within 5 s) and shows the waiting banner; the button becomes "I'm unblocked".
- [ ] When the trainer acknowledges, the banner changes within 10 s; when they resolve with a note, the note is shown and the button returns to normal after 5 min (or on dismiss).
- [ ] Clicking "I'm unblocked" cancels the request on the admin within 5 s.
- [ ] If the server is unreachable, the click shows "Could not send the request, retrying" and the request is sent when the server is back (no duplicate).

**References**: Business Rules 9, 10, Flows (Help request), UI / UX (local additions), Story 2

---

### T15 — [test] Automated tests on both sides and documentation

**Jira**: none
**Agent hint**: backend-development:test-automator
**Depends on**: T5, T6, T7, T13, T14

**User outcome**: A contributor runs one command per application and gets a green test suite covering the API rules, the projections and the local reporting client; the READMEs explain how to deploy the admin, distribute the workshop key and configure a developer machine.

**Business constraints**:
- Admin: unit tests for auth (workshop key, token binding, rate limit), projection rules (idempotency, reordering, snapshot authority, completion stickiness), help state machine; route tests for every public endpoint; no test touches the shared DB.
- Local dashboard: tests with a fake HTTP server covering outbox persistence, backoff, batch ordering, snapshot content, re-registration on 401, and an end-to-end run proving a hanging server never delays a run.
- Docs: the admin `README.md`, a "Reporting to the admin dashboard" section in `Dashboard/README.md` of the labs repository, and a line in its root README.

**Success criteria**:
- [ ] `pnpm test` here and `dotnet test` in `Dashboard/` of the labs repository pass; the Vercel build runs the admin tests.
- [ ] Each Business Rule 2–15 has at least one named test.
- [ ] A new developer following `Dashboard/README.md` can configure reporting and appear on the admin without asking a question.

**References**: Business Rules, Edge Cases, Event Types

---

## Test Plan

Status: done for the API flows (2026-10-02, macOS, admin on `http://127.0.0.1:3457` with the in-memory replica set, local dashboard on port 5058 with a throwaway data folder). **The browser pass of the two UIs (steps 2, 7, 8, 10) still needs a manual run.**

**Setup.** Admin (this repository): `pnpm install && pnpm mongo:memory` (keep it running), then in another terminal `MONGODB_URI="mongodb://127.0.0.1:27017/?replicaSet=testset" MONGODB_DB=labs-admin-qa WORKSHOP_KEY=dev-workshop-key ADMIN_PASSWORD=qa SESSION_SECRET=qa-session-secret-0123456789 pnpm dev -p 3457`. Local dashboard (labs repository): `cd Dashboard/LabDashboard && Dashboard__Port=5058 Dashboard__DataDirectory=../.data-qa Dashboard__Reporting__ServerUrl=http://127.0.0.1:3457 Dashboard__Reporting__WorkshopKey=dev-workshop-key dotnet run`. Delete `Dashboard/.data-qa` after QA.

1. **Health** — `curl http://127.0.0.1:3457/api/v1/health` → `{"status":"ok","version":"0.1.0","db":"ok"}`. *(T1, T2)*
2. **First launch** — open http://127.0.0.1:5058: the welcome dialog asks only a username (URL and key are preconfigured). `a` → field error; `e2e-dev` → dialog closes, top-bar pill *Reporting to 127.0.0.1 as e2e-dev* (green). `Dashboard/.data-qa/identity.json` exists with mode `600`. Restart the dashboard: no dialog, same `userId`. *(Story 6, Business Rules 1, 3, T12)*
3. **Admin login and overview** — http://127.0.0.1:3457 redirects to `/login?next=%2F`; wrong password → error; `qa` → overview with counters `devs 1 · online 1`, one card *e2e-dev* (short id, *Online*, 0 / 10) and the 10 labs of the catalog. *(T7, T8)*
4. **Run reported** — in the local dashboard run Lab01 **Start** (the delivered exercise). Within 5 s the card shows *Running* then, when it ends, the detail page shows Lab01 *In progress · Failed (checks) · 1 run*; the feed lists `run.started`, `run.finished`, `progress.snapshot`. *(T5, T9, T13)*
5. **Help request** — click **Help / Je suis bloqué**, message "Je ne comprends pas le TODO 2", Send. Admin: the card moves to the top as *Needs help*, the banner and `/help` list the request with dev, lab and message. **Acknowledge** → within 10 s the local banner says *Taken into account by the trainer*. **Resolve** with note "Vu ensemble: utiliser AsAIAgent()" → within 10 s the local banner shows *Resolved: Vu ensemble…*; the request is in the history tab. *(Stories 2, 3, Business Rules 9, 10, T6, T10, T14)*
6. **I'm unblocked** — raise a second request, then click **I'm unblocked**: the admin queue is empty, the history shows it *cancelled by dev*. A third request while one is active is refused locally (the existing one is shown). *(Business Rule 9)*
7. **Matrix and CSV** — `/matrix`: Lab01 cell *In progress*, others *Not started*; **Export CSV** downloads one row for e2e-dev. *(T11)*
8. **Languages** — switch both UIs to **FR**: every label of the overview, queue, detail and of the local dialog/banner is translated. *(UI/UX)*
9. **Offline resilience** — stop the admin. In the local dashboard open Lab02 and its solution: the pill turns amber *offline, retrying*, `outbox.json` holds `lab.opened` and `solution.viewed`, and running a lab works exactly as before. Restart the admin: within 10 s the pill is green, the outbox is empty, the feed shows both events once, Lab02 has *solution viewed*. *(Story 4, Business Rule 7, T13)*
10. **Reporting disabled** — start the local dashboard without `Dashboard__Reporting__ServerUrl`: no dialog, no pill, no Help button, no request to the admin. *(Edge case "reporting not configured")*
11. **API guards** — register without `X-Workshop-Key` → 401; events with the token of dev A and the `userId` of dev B → 403; 121 event batches in a minute → 429 with `Retry-After`; `/api/admin/overview` without cookie → 401. *(Business Rules 2, 5, 13, 15, T3)*

Automated: `pnpm lint && pnpm typecheck && pnpm test` here (30 tests, vitest + MongoMemoryReplSet) and `cd Dashboard && dotnet test` (139 tests, including `ReportingClientTests` with a fake admin server and the hanging-server run).

## Dependencies

- **Blocked by** (deployment only): a Vercel project and a MongoDB Atlas cluster (M0) to be created; a workshop key and admin password to be generated. See `README.md`.
- **Blocks**: nothing today; a future multi-cohort version and a future SSE / Realtime push depend on this data model.
- **External**: Vercel (hosting), MongoDB Atlas (database), `mongodb` Node driver, zod, TanStack Query, Next.js 15 / React 19. No third-party auth, no e-mail, no analytics.

## Out of Scope / Future Considerations

- **Push instead of polling**: SSE route fed by a MongoDB change stream once the number of trainer tabs or the latency target justifies it; the API and data model do not change.
- **Cohorts / sessions**: a `cohorts` collection and a per-cohort workshop key to run several workshops on one deployment; the overview filtered by cohort.
- **Trainer SSO** (Microsoft Entra ID) instead of a shared admin password.
- **Trainer → developer messages** (short reply attached to a help request shown in the local dashboard).
- **Merging two identities** when a developer lost their identity file.
- **Retention**: TTL index on `events.receivedAt` to purge events older than N days (volume is small for a workshop; not needed in v1).
- **Lab-level analytics**: median time to complete, most failed check per lab, token cost per lab.
- **Reporting from the CLI** (`dotnet run` outside the dashboard) is deliberately not tracked.

## Open Questions

> All questions were closed on 2026-10-02 with the recommended default (user's GO), unless stated otherwise. Jira is not used for this spec.

- [x] **Q1 — Location of the new app**: decided in this repository first, then **isolated in its own repository on 2026-10-02** (the user's choice); the spec moved with the app and stays the contract for the labs repository.
- [x] **Q2 — Hosting and database**: **decided 2026-10-02 — Vercel + MongoDB Atlas** (official driver, no migrations). In-memory storage was ruled out: serverless instances share nothing and lose everything on redeploy.
- [x] **Q3 — Near real time**: polling every 3 s (recommended for v1, zero infrastructure) or push (SSE / Realtime) from day one?
- [x] **Q4 — Public API protection**: workshop key + per-dev token (recommended) or workshop key only (simpler, but anyone with the key can impersonate any `userId`)?
- [x] **Q5 — Admin access**: single admin password in an environment variable (recommended for v1) or Microsoft Entra ID login now?
- [x] **Q6 — Username uniqueness**: not enforced, disambiguated by the short id (recommended) or enforced at registration (first come, first served)?
- [x] **Q7 — Where does the developer enter the server URL and workshop key**: preconfigured in `appsettings.json` / user secrets by the trainer's instructions (recommended, the welcome dialog asks only the username) or typed in the welcome dialog?
- [x] **Q8 — Developer-side cancel**: should the developer be able to close their own request with "I'm unblocked" (recommended) or only the trainer?
- [x] **Q9 — Help message**: optional 500-char message with the request (recommended) or button only?
- [x] **Q10 — Admin UI languages**: EN + FR switch like the local dashboard (recommended, small cost) or English only?
- [x] **Q11 — Token usage on the admin**: show reported token totals per lab and per dev (recommended, data already in `run.finished`) or omit?
- [x] **Q12 — Spec language**: this spec is written in English to match the two existing specs and the READMEs; say the word and it is rewritten in French.
