# Lab Bench Admin — admin dashboard and progress tracking API

The hosted companion of the local **Lab Bench** dashboard (`Dashboard/LabDashboard` in the *Microsoft Agent Framework Learning Labs* repository). Each developer's local dashboard reports
its identity, runs, progress, heartbeats and help requests to the public API of this app; the trainer opens one web
page and sees every developer, their progress lab by lab, who is running what, and who is asking for help.

Specification and API contract (shared with the labs repository): [`specs/admin-dashboard-progress-tracking/spec.md`](specs/admin-dashboard-progress-tracking/spec.md).

- **Stack**: Next.js (App Router, TypeScript, React 19), MongoDB (official driver, one cached client), zod, TanStack Query, Tailwind.
- **Hosting**: Vercel (this repository root is the Next.js project) + MongoDB Atlas (free M0 is enough for a cohort).
- **Near real time**: the admin pages poll every 3 s (overview, help queue) or 5 s (matrix, developer detail).

## Run it locally

```bash
cd AdminDashboard
pnpm install
cp .env.example .env.local        # then edit WORKSHOP_KEY, ADMIN_PASSWORD, SESSION_SECRET
```

Pick one MongoDB:

| Option | Command | `MONGODB_URI` |
|---|---|---|
| Docker (persistent, single-node replica set) | `docker compose up -d` | `mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true` |
| In-memory (no Docker, data lost on stop) | `pnpm mongo:memory` (keep it running) | printed by the command |

Then:

```bash
pnpm seed      # optional: 3 developers, 10 labs, a few runs, one open help request (dev database only)
pnpm dev       # http://localhost:3000 → /login with ADMIN_PASSWORD (another port: pnpm dev -p 3457)
```

Quality gates: `pnpm lint`, `pnpm typecheck`, `pnpm test` (vitest + an in-memory MongoDB replica set, no Docker needed), `pnpm build`.

## Environment variables

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | Connection string (Atlas `mongodb+srv://…` in production). |
| `MONGODB_DB` | Database name, default `labs-admin`. The seed refuses any name other than `labs-admin` or `*-dev`. |
| `WORKSHOP_KEY` | Shared secret given to the developers of the cohort; required to register a local dashboard (`X-Workshop-Key`). |
| `ADMIN_PASSWORD` | Trainer password for `/login`. |
| `SESSION_SECRET` | ≥ 16 characters, signs the admin session cookie (httpOnly, SameSite=Lax, 12 h). |

Without `ADMIN_PASSWORD` / `SESSION_SECRET` the admin pages show a configuration error; the public API keeps working.

## Deploy (Vercel + Atlas)

1. Create a MongoDB Atlas cluster (M0), a database user, and allow access from anywhere (Vercel has no fixed IPs) or use Atlas's Vercel integration.
2. Create a Vercel project from this repository (framework: Next.js, install command `pnpm install`; the repository root is the project, no Root Directory to set).
3. Set the five environment variables above (Production and Preview). Generate secrets with `openssl rand -base64 32`.
4. Deploy. Check `https://<your-app>/api/v1/health` → `{ "status": "ok", "db": "ok" }`.
5. Give the developers the URL and the `WORKSHOP_KEY`; they put them in the **Reporting** settings of their local dashboard.

Collections and indexes are created by the app itself (`ensureIndexes` on the first database access, plus a startup check that logs anything missing). There is no migration step.

## Data

Five collections (see the spec's Data Model): `devs` (one document per developer, lab progression **embedded**), `labs`
(catalog union reported by the dashboards), `runs`, `helpRequests` (partial unique index: one open/acknowledged request
per developer), `events` (append-only log, `_id` = client `eventId` for idempotency).

Each batch of events is applied inside one multi-document transaction when the server is a replica set (Atlas, the
Docker compose, the in-memory server used by the tests). Against a **standalone** `mongod` the app detects the missing
transaction support on the first batch, logs a warning once and applies batches without a transaction (idempotency by
`eventId` still holds; only the all-or-nothing guarantee of a batch is lost).

## API

Public (called by the .NET server of each local dashboard, never by a browser; JSON; errors are `{ error, message, details? }`):

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/v1/devs/register` `{ userId, username, dashboardVersion?, platform? }` | `X-Workshop-Key` (+ `Authorization: Bearer` when the id is already known) | 201 with `devToken` the first time; 200 refresh afterwards; 403 for a known id without its token |
| `POST /api/v1/events` `{ userId, username, events: [{ eventId, type, occurredAt, labId?, payload }] }` | Bearer dev token | 202 `{ accepted, ignored, serverTime }`; 1–100 events, 256 KB, all-or-nothing, duplicates ignored |
| `POST /api/v1/help-requests` `{ userId, username, labId?, message? }` | Bearer | 201, or 409 with the existing active request |
| `POST /api/v1/help-requests/{id}/cancel` `{ userId, username }` | Bearer | "I'm unblocked" |
| `GET /api/v1/devs/me` | Bearer | Active help request and its status, server time |
| `GET /api/v1/health` | none | `{ status, version, db }`, 503 when the database is unreachable |

Event types understood by the projection: `catalog.synced`, `progress.snapshot`, `lab.opened`, `run.started`,
`run.finished`, `solution.viewed`, `heartbeat`, `settings.changed`. Any other lower-case dotted type is stored and shown
in the feed as "Other event". Rate limits: 120 requests/min per token, 30 registrations/min per IP (429 + `Retry-After`).

Admin (session cookie): `POST /api/admin/login|logout`, `GET /api/admin/overview`, `GET /api/admin/matrix`,
`GET /api/admin/devs/{id}`, `POST /api/admin/devs/{id}/archive|unarchive`, `GET /api/admin/help-requests?status=…`,
`POST /api/admin/help-requests/{id}/acknowledge|resolve`, `GET /api/admin/events?devId=&type=&cursor=`.

## Pages

| Route | Content |
|---|---|
| `/login` | Trainer password (5 failures per IP per 15 min → 429). |
| `/` | Counters, banner of open help requests with inline Acknowledge / Resolve, developer cards sorted needs-help → running → online → idle → offline. |
| `/matrix` | Labs × developers grid, blocked cells outlined in red, CSV export. |
| `/help` | Active queue (oldest first) and history, optional sound alert (stored in the browser). |
| `/devs/[userId]` | Labs with state / last result / runs / tokens, last 50 runs, help requests, paginated activity feed, archive / unarchive. |

English and French (`EN | FR` in the top bar), dark theme, usable on a tablet.

## Limits worth knowing

- Rate-limit and login-throttle counters live in memory: on serverless hosting each instance counts separately. They are a safety net, not accounting.
- A developer who deletes their local `identity.json` becomes a new developer here; archive the old one.
- No cohort / multi-workshop separation yet: one deployment = one cohort (see the spec's Future Considerations).
