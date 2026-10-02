---
title: Multi-Workshop Support
status: implemented
priority: high
author: PM Agent
created: 2026-10-03
updated: 2026-10-03
jira_project: none
jira_epic: none
---

# Multi-Workshop Support

## Summary

Today one deployment of the Admin Dashboard serves exactly one cohort: the workshop key is a single environment variable (`WORKSHOP_KEY`), and every developer who registers with it lands in one flat list. This feature makes **workshops first-class objects managed from the admin interface**. The trainer creates as many workshops as they need (for example "Paris, 14 Oct" or "Team Payments"). Each workshop gets its own generated **workshop code** that the trainer copies from the admin and hands to the students. A developer's local dashboard sends that code as `X-Workshop-Key` when it registers, exactly as it does today, so **the local dashboard does not change**. The developer is attached to that workshop, and so are their runs, events and help requests. A **workshop selector** in the admin top bar scopes the overview, matrix, CSV export, help queue and activity feed to one workshop, or shows all of them.

## Problem Statement

- The workshop key lives in `.env` / Vercel settings. Starting a new session means editing environment variables and redeploying, and the trainer cannot see or copy the key from the admin UI.
- Every developer of every session ends up in one list. Running two sessions in parallel, or keeping last week's cohort while starting a new one, mixes everyone in the overview, the matrix and the help queue.
- Archiving developers one by one is the only way to "start fresh", and it loses the link between a developer and the session they attended.
- Without this feature, the trainer either redeploys for each cohort or works through a growing, mixed list of developers.

## Goals

- [ ] The trainer creates a workshop from the admin in under 30 seconds and copies its code with one click. No redeploy and no environment change are needed.
- [ ] A developer who registers with a workshop's code appears only in that workshop's views within 5 seconds.
- [ ] With a workshop selected, the overview, matrix, CSV export, help queue and activity feed show only that workshop's developers and their data. "All workshops" shows everything, as today.
- [ ] Existing data and existing local dashboards keep working after the upgrade with no manual data editing (the legacy `WORKSHOP_KEY` becomes a "Default workshop").

## Non-Goals

- No change to the local dashboard (.NET, labs repository): the workshop code goes into the existing `WorkshopKey` setting, and the `X-Workshop-Key` header and API contract are unchanged.
- No per-workshop trainers or permissions: there is still one admin password, and the admin sees every workshop.
- No per-workshop lab catalog: labs stay global, as reported by the dashboards.
- No scheduling, capacity limits, invitations or e-mailing of codes.
- No moving a developer between workshops from the admin UI (see Open Questions; re-registering with another code is the only path in v1).

## Changelog

- **v1.0** (2026-10-03) — Initial release. Tasks T1..T10, no Jira (tracked in this file only).
- **v1.1** (2026-10-03) — Implemented T1–T10 with the defaults of Q1–Q4. Deviations: the registration rate limit now runs before the code lookup (so code guessing is throttled too); the top-bar help badge was not scoped because the top bar shows no help count today; the selector is remembered in a cookie (not localStorage) so server-rendered pages start in the right scope; a closed workshop's devs keep reporting; the native `<dialog>` of the help Resolve action was centred as well (it had the same Tailwind-reset issue).

---

## Reference

### Data Model

MongoDB (official driver, no migrations; indexes declared in `INDEXES` and ensured at startup). New collection `workshops`, plus a `workshopId` field stamped on the existing collections.

```ts
// New collection: workshops
interface WorkshopDoc {
  _id: string;              // UUID v4
  name: string;             // 2–80 chars, trimmed; not required to be unique
  code: string;             // normalized form, e.g. "K7QX9MPA" (8 chars, see Business Rule 2); unique
  status: "active" | "closed";
  createdAt: Date;
  updatedAt: Date;
  closedAt?: Date | null;
  codeRotatedAt?: Date;     // last time the code was regenerated
  legacy?: boolean;         // true for the "Default workshop" created from WORKSHOP_KEY
}

// Existing collections: new field
interface DevDoc         { /* … */ workshopId: string; }   // workshop the dev registered with
interface RunDoc         { /* … */ workshopId: string; }   // copied from the dev at write time
interface EventDoc       { /* … */ workshopId: string; }   // copied from the dev at write time
interface HelpRequestDoc { /* … */ workshopId: string; }   // copied from the dev at write time
```

Indexes:

| Collection | Index | Purpose |
|---|---|---|
| `workshops` | `{ code: 1 }` unique | Register lookup, code uniqueness |
| `workshops` | `{ status: 1, createdAt: -1 }` | Workshops list and selector |
| `devs` | `{ workshopId: 1, archivedAt: 1, lastActivityAt: -1 }` | Overview scoped to a workshop |
| `helpRequests` | `{ workshopId: 1, status: 1, createdAt: 1 }` | Help queue scoped to a workshop |
| `events` | `{ workshopId: 1, receivedAt: -1 }` | Feed scoped to a workshop |
| `runs` | `{ workshopId: 1, startedAt: -1 }` | Matrix / stats scoped to a workshop |

### Business Rules

1. **A workshop code authorizes registration.** `POST /api/v1/devs/register` resolves `X-Workshop-Key` against `workshops.code` (after normalization). An unknown code returns 401, as a wrong key does today. A code of a `closed` workshop returns 401 with the message "This workshop is closed". On success the developer's `workshopId` is set to that workshop.
2. **Code format.** Codes are 8 characters drawn from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0/O, 1/I/L), generated with a CSPRNG, and stored without separators. They are displayed as `XXXX-XXXX`. Input is normalized before comparison (trim, uppercase, remove `-` and spaces), so `k7qx-9mpa`, `K7QX9MPA` and `K7QX 9MPA` all match. Generation retries on a uniqueness collision.
3. **Code rotation.** Regenerating a code invalidates the old one immediately for new registrations. Developers already registered keep reporting, because every call after registration uses their dev token, not the code.
4. **Closing a workshop.** A closed workshop rejects new registrations (Rule 1), but its already-registered developers keep reporting events and help requests normally, so the end of a session is never lost. A closed workshop can be reopened. Closed workshops are listed after active ones in the selector, under a "Closed" group.
5. **Deleting a workshop.** Allowed only when the workshop has zero developers (archived ones included). Otherwise the delete action is disabled and the API returns 409.
6. **Re-registration with another code.** A known `userId` with a valid dev token that registers with a different workshop's code moves to that workshop: `devs.workshopId` is updated. Past runs, events and help requests keep the `workshopId` they were written with, and new ones get the new workshop.
7. **Stamping.** Every run, event and help request is written with the dev's current `workshopId`, read in the same request that authenticates the dev token. No admin query joins through `devs` to find a workshop.
8. **Scope filter.** Every admin read endpoint (overview, counters, matrix, CSV, help queue, events feed) accepts an optional `workshopId`. When it is absent, data from all workshops is returned (today's behavior). An unknown `workshopId` returns 404. Developer detail pages are reachable whatever the selected scope and show the developer's workshop.
9. **Legacy migration.** At startup or via an explicit script, if `WORKSHOP_KEY` is set and no workshop has that code, a workshop named "Default workshop" (`legacy: true`, `active`) is created with `code` = the normalized env value, even if it does not follow Rule 2's format. All documents without a `workshopId` are then assigned to it. The process is idempotent. After it runs, `WORKSHOP_KEY` is no longer read for authorization and can be removed from the environment.
10. **Admin only.** Every workshop management endpoint requires the admin session (same guard as the other `/api/admin/*` routes). Codes are returned only by admin endpoints, never by the public `/api/v1` API.

### Edge Cases

| Case | Expected behavior |
|---|---|
| No workshop exists yet (fresh install, no `WORKSHOP_KEY`) | Overview shows an empty state "Create your first workshop" with a button to `/workshops`. Every registration gets 401. |
| Workshop name empty / 1 char / 81 chars | Inline field error, nothing created; API returns 400 with `field: "name"`. |
| Two workshops with the same name | Allowed; they are told apart by their code and creation date in the list and selector. |
| Code typed by the student in lowercase or with the dash | Accepted (Rule 2 normalization). |
| Trainer regenerates a code while students are registering | Students who already registered keep working. A student registering with the old code gets 401, and the trainer hands out the new one. |
| Selected workshop (remembered in the browser) was deleted | Selector silently falls back to "All workshops". |
| Delete a workshop with developers | Button disabled with tooltip "Has N developers". The API returns 409 if called anyway. |
| CSV export with a workshop selected | Only that workshop's developers; file name contains the workshop name (slugified) and date. |
| Help request from a dev of a closed workshop | Accepted and shown in the queue (Rule 4). |
| Legacy `WORKSHOP_KEY` with a non-standard value (e.g. a long base64 string) | The Default workshop keeps that exact (normalized) code, and its display shows the code as-is without the `XXXX-XXXX` grouping. |

### UI / UX

| Page / View | Route | Purpose |
|---|---|---|
| Workshops | `/workshops` | List, create, rename, copy code, copy student instructions, regenerate code, close / reopen, delete |
| Workshop selector | top bar, all admin pages | Scope overview, matrix, help queue and feed to one workshop or "All workshops" |
| Overview / Matrix / Help | `/`, `/matrix`, `/help` | Existing pages, now scoped by the selector |
| Developer detail | `/devs/[userId]` | Existing page, adds a workshop badge |

The **Workshops** page is a table with one row per workshop: name, code (monospace, `XXXX-XXXX`, with a copy button and a "Copied" confirmation), status pill (Active / Closed), number of developers (active / total), and created date. A row action menu offers Rename, Regenerate code (confirmation dialog explaining Rule 3), Close / Reopen, and Delete (only when empty, with confirmation). A "New workshop" button opens a one-field dialog (name). Once the workshop is created, the dialog shows the code large and offers **Copy code** and **Copy student instructions**. The instructions are a short text block in the current UI language with the server URL (the admin's origin) and the code, in the form the local dashboard expects (`ServerUrl` / `WorkshopKey`).

The **selector** is a compact dropdown in the top bar, left of the language switch: "All workshops", then active workshops (newest first), then a "Closed" group. The choice is remembered per browser, like the language. In "All workshops" mode, developer cards and matrix rows show a small workshop label; in single-workshop mode the label is hidden. EN + FR like the rest of the admin. The page is usable at phone width (the table collapses to cards).

### User Stories

#### Story 1: Trainer creates a workshop and hands out the code
**As a** trainer, **I want to** create a workshop from the admin and copy its code, **so that** I can start a new session without touching Vercel or redeploying.

#### Story 2: Developer joins the right workshop
**As a** developer, **I want to** paste the code my trainer gave me into my dashboard settings, **so that** my progress shows up in my session and not someone else's.

#### Story 3: Trainer focuses on one session
**As a** trainer running two sessions, **I want to** pick one workshop in the top bar, **so that** the overview, matrix and help queue only show the people in front of me.

#### Story 4: Trainer controls access
**As a** trainer, **I want to** close a workshop or regenerate its code, **so that** a leaked code cannot be used to join after the session, without cutting off those already in.

#### Story 5: Upgrade without breaking current students
**As a** trainer with developers already reporting, **I want** the existing key to keep working as a "Default workshop", **so that** the upgrade needs no action from students.

---

## Tasks

> Each block below becomes ONE Jira Task. The Epic is created from the spec header.

### T1 — [db] Workshops collection and workshop field on existing data

**Jira**: none
**Agent hint**: database-design:database-architect
**Depends on**: —

**User outcome**: The database can hold workshops and know which workshop every developer, run, event and help request belongs to. Starting the app on an empty or existing database creates the new collection and indexes automatically, with no manual step.

**Business constraints**:
- Follows the Data Model exactly (collection, fields, indexes).
- Indexes are declared alongside the existing ones and ensured idempotently, and the startup missing-index check covers them.
- Existing documents without `workshopId` must not break any existing page or API (they are backfilled by T8).

**Success criteria**:
- [ ] On a fresh database, starting the app creates the `workshops` collection and every index listed in the Data Model.
- [ ] The startup log reports no missing indexes after the first start.
- [ ] Existing pages (overview, matrix, help, dev detail) still load on a database that contains developers without a workshop.

**References**: Data Model, Business Rule 7

---

### T2 — [security] Registration authorized by workshop codes

**Jira**: none
**Agent hint**: backend-api-security:backend-security-coder
**Depends on**: T1

**User outcome**: A developer whose local dashboard is configured with a workshop's code registers successfully and is attached to that workshop. A wrong, rotated or closed-workshop code is rejected exactly the way a wrong key is rejected today, and the local dashboard shows "rejected (workshop key)".

**Business constraints**:
- Business Rules 1, 2 (normalization), 3, 4 (closed rejects registration only), 6 (re-registration moves the dev).
- Code lookup must not reveal through timing or messages whether a code exists in another state, except the explicit "closed" message of Rule 1.
- Registration rate limits per IP stay in place.
- The `/api/v1` request and response shapes are unchanged.

**Success criteria**:
- [ ] Register with an active workshop's code → 201, and the developer appears under that workshop in the admin.
- [ ] Register with the same code in lowercase and with/without the dash → accepted.
- [ ] Register with an unknown code → 401. With a closed workshop's code → 401 "This workshop is closed". With a code that was just regenerated → 401.
- [ ] An already-registered dev (valid token) registering with another workshop's code → 200, and the dev now appears under the new workshop.

**References**: Business Rules 1–4, 6, Edge Cases ("code typed in lowercase", "regenerates while registering"), Story 2

---

### T3 — [backend] Runs, events and help requests stamped with the workshop

**Jira**: none
**Agent hint**: backend-development:backend-architect
**Depends on**: T1

**User outcome**: Everything a developer reports after registering is tagged with their workshop, so per-workshop views (T6) show the right runs, feed entries and help requests. Developers of a closed workshop keep reporting normally.

**Business constraints**:
- Business Rules 4 and 7: the workshop is taken from the authenticated dev in the same request, with no extra round-trip per event in a batch.
- Event batch idempotency, ordering and transaction behavior are unchanged.

**Success criteria**:
- [ ] After a dev runs a lab and raises a help request, the new run, its events and the help request all carry the dev's workshop (visible through the scoped admin views).
- [ ] A dev whose workshop is closed can still send events and help requests (202 / 201), and they appear in that workshop's views.
- [ ] After a dev moves workshop (T2), their new activity appears under the new workshop and their old activity stays under the old one.

**References**: Business Rules 4, 6, 7, Edge Cases ("help request from a dev of a closed workshop")

---

### T4 — [backend] Admin API to manage workshops

**Jira**: none
**Agent hint**: backend-development:backend-architect
**Depends on**: T1

**User outcome**: The admin interface can list workshops with their developer counts, create one (getting its code back), rename it, regenerate its code, close or reopen it, and delete it when empty.

**Business constraints**:
- Business Rules 2 (generation), 3, 4, 5 (409 when not empty), 10 (admin session required).
- Name validation per Edge Cases; validation errors use the existing error format with the field name.
- The list returns, per workshop: id, name, code, status, created/closed dates, active developer count and total developer count.

**Success criteria**:
- [ ] Without the admin session cookie every workshop endpoint returns 401.
- [ ] Creating "Paris 14 Oct" returns a new workshop with an 8-character code that registers successfully (T2).
- [ ] Regenerating returns a new code; the old code is rejected at registration and the new one is accepted.
- [ ] Deleting a workshop that has a developer returns 409; deleting an empty one succeeds and it disappears from the list.

**References**: Data Model, Business Rules 2–5, 10, Edge Cases ("name empty", "two workshops with the same name", "delete with developers"), Stories 1, 4

---

### T5 — [frontend] Workshops page: create, copy code, rotate, close, delete

**Jira**: none
**Agent hint**: frontend-mobile-development:frontend-developer
**Depends on**: T4

**User outcome**: The trainer opens **Workshops** from the top navigation, clicks **New workshop**, types a name, and immediately sees the code with **Copy code** and **Copy student instructions** buttons. From the list they can rename a workshop, regenerate its code (after confirming), close or reopen it, and delete an empty one.

**Business constraints**:
- Behaves as described in UI / UX (table, row actions, creation dialog, instructions text with the admin's origin as server URL).
- Regenerate and Delete require an explicit confirmation. Delete is disabled with a reason when the workshop has developers (Business Rule 5).
- Follows the project's data-fetching rules: list refreshes after create/delete, and rename/close/rotate patch the list without a full reload.
- EN + FR, usable at phone width.

**Success criteria**:
- [ ] Create a workshop → the dialog shows its code as `XXXX-XXXX`, and **Copy code** puts the code on the clipboard with a visible "Copied" confirmation.
- [ ] **Copy student instructions** copies a text containing the admin URL and the code, in the current UI language.
- [ ] Regenerate shows a confirmation, then the row shows a new code.
- [ ] Close turns the status pill to Closed and Reopen turns it back. Delete is disabled on a workshop with developers and works on an empty one.
- [ ] The page is fully usable in FR and at a 375 px wide viewport.

**References**: UI / UX, Business Rules 3–5, Edge Cases ("two workshops with the same name", "delete with developers"), Stories 1, 4

---

### T6 — [backend] Admin views filterable by workshop

**Jira**: none
**Agent hint**: backend-development:backend-architect
**Depends on**: T1, T3

**User outcome**: The overview, counters, matrix, CSV export, help queue and activity feed can return data for a single workshop. Without a workshop filter they return everything, as today.

**Business constraints**:
- Business Rule 8 (optional filter, absent = all, unknown id = 404).
- Scoped queries use the new workshop indexes; no full scan of `devs` / `events` per poll.
- Responses in "all" mode include each developer's workshop (id + name) so the UI can label them.
- CSV file name per Edge Cases.

**Success criteria**:
- [ ] With two workshops each holding one dev, the overview filtered on workshop A lists only A's dev, and the counters count only A.
- [ ] The help queue filtered on A shows only A's requests; unfiltered it shows both.
- [ ] The matrix CSV filtered on A contains one row and its file name contains A's name.
- [ ] Filtering on a non-existent workshop id returns 404.

**References**: Business Rule 8, Data Model (indexes), Edge Cases ("CSV export with a workshop selected"), Story 3

---

### T7 — [frontend] Workshop selector scoping every admin page

**Jira**: none
**Agent hint**: frontend-mobile-development:frontend-developer
**Depends on**: T5, T6

**User outcome**: A dropdown in the top bar lets the trainer pick "All workshops" or one workshop. The overview, matrix, help queue and feed update immediately to that scope and keep refreshing live. The choice is remembered when they come back. In "All" mode each developer shows a small workshop label, and the developer detail page always shows the developer's workshop.

**Business constraints**:
- Behaves as described in UI / UX (grouping, ordering, per-browser memory like the language preference).
- Edge Cases: deleted remembered workshop falls back to "All workshops"; no workshops yet shows the empty state pointing to `/workshops`.
- The help count badge in the navigation follows the selected scope.
- Switching scope must not show a blank page between results.

**Success criteria**:
- [ ] Select workshop A: the overview, matrix and help queue show only A's developers and requests, and the help badge counts only A's open requests.
- [ ] Reload the browser: workshop A is still selected.
- [ ] Delete the remembered workshop (from another tab), reload: the selector shows "All workshops" with no error.
- [ ] In "All workshops", each developer card and matrix row shows its workshop name; the developer detail page shows it whatever the scope.
- [ ] With no workshop at all, the overview shows "Create your first workshop" linking to the Workshops page.

**References**: UI / UX, Business Rule 8, Edge Cases ("no workshop exists yet", "selected workshop was deleted"), Story 3

---

### T8 — [db] Legacy WORKSHOP_KEY becomes the Default workshop

**Jira**: none
**Agent hint**: database-design:database-architect
**Depends on**: T1, T2

**User outcome**: After upgrading, a deployment that had `WORKSHOP_KEY` set shows a "Default workshop" in the Workshops page, holding every existing developer and their history. Students whose local dashboards still use the old key keep registering and reporting without changing anything.

**Business constraints**:
- Business Rule 9: idempotent (running twice changes nothing), never overwrites an existing workshop, and keeps the env key's exact normalized value as the code.
- Runs automatically at startup and is also available as an explicit `pnpm` script for operators; failure at startup is logged, not fatal (same policy as the index check).
- Backfills `workshopId` on devs, runs, events and help requests that lack it.

**Success criteria**:
- [ ] On a database with developers and `WORKSHOP_KEY=abc…` set, after start: the Workshops page lists "Default workshop" with all existing developers counted.
- [ ] A local dashboard still configured with the old key registers successfully (201/200).
- [ ] Running the script a second time reports nothing to do and creates no second workshop.
- [ ] With `WORKSHOP_KEY` unset on a fresh database, no Default workshop is created.

**References**: Business Rule 9, Edge Cases ("legacy WORKSHOP_KEY with a non-standard value"), Story 5

---

### T9 — [glue] Navigation, translations, seed and documentation

**Jira**: none
**Agent hint**: code-improver
**Depends on**: T5, T7, T8

**User outcome**: "Workshops" appears in the top navigation, every new label is translated into French, the dev seed creates two sample workshops with developers split between them, and the README and `.env.example` explain that workshops are managed in the admin and that `WORKSHOP_KEY` is now optional (legacy only).

**Business constraints**:
- The seed keeps its existing safety check (dev database names only).
- The README documents the student instructions flow (create workshop → copy instructions → student pastes them into the local dashboard settings).

**Success criteria**:
- [ ] The top navigation shows Workshops (EN) / Ateliers (FR) and highlights it on `/workshops`.
- [ ] Switching to FR leaves no English label on the Workshops page, the selector or the creation dialog.
- [ ] `pnpm seed` on a dev database produces two workshops visible in the selector, each with developers.
- [ ] A new contributor can follow the README to create a workshop and register a local dashboard with its code.

**References**: UI / UX, Business Rule 9, Stories 1, 2

---

### T10 — [test] Automated tests for workshops

**Jira**: none
**Agent hint**: unit-testing:test-automator
**Depends on**: T2, T3, T4, T6, T8

**User outcome**: `pnpm test` covers workshop codes, registration against workshops, stamping, scoped admin queries and the legacy migration, so a regression in tenant scoping fails the build.

**Business constraints**:
- Uses the existing test setup (vitest + in-memory MongoDB replica set).
- Covers at least: code normalization and alphabet (Rule 2), unknown/closed/rotated code rejection, re-registration move (Rule 6), stamping on runs/events/help (Rule 7), scope isolation between two workshops (Rule 8), delete-with-devs 409 (Rule 5), migration idempotency (Rule 9), and 401 on workshop endpoints without a session (Rule 10).

**Success criteria**:
- [ ] `pnpm lint && pnpm typecheck && pnpm test` pass.
- [ ] Intentionally removing the workshop filter from one admin query makes at least one test fail.

**References**: Business Rules 1–10

---

## Test Plan

Status: automated tests pass, and a browser pass was run on 2026-10-03 against an in-memory database with `pnpm seed` data (overview in "All workshops" and scoped modes, creating a workshop, registering with its code typed in lowercase, FR, 375 px viewport). Not tested: real clipboard writes, and the local .NET dashboard against a deployed admin.

**Setup.** `pnpm mongo:memory`, then `MONGODB_URI=<printed uri> MONGODB_DB=labs-admin-dev pnpm seed` and `MONGODB_URI=<uri> MONGODB_DB=labs-admin-dev ADMIN_PASSWORD=qa SESSION_SECRET=qa-session-secret-0123456789 pnpm dev -p 3457`. Sign in at http://localhost:3457 with `qa`.

1. **All workshops** — the overview shows alice, bob (label *Paris — sample session*) and chloe (*Remote — sample session*); the help banner shows alice with her workshop label. *(Story 3, T7)*
2. **Scope** — pick *Remote — sample session* in the top bar: only chloe, counters `1 / 0 / 0 / 0`, no help banner. Reload: still Remote. `/matrix` and `/help` show only chloe / no request; **Export CSV** downloads `labs-matrix-remote-sample-session-<date>.csv`. *(Business Rule 8, T6, T7)*
3. **Create** — `/workshops` → **New workshop** → `a` → error *2 to 80 characters*; `Lyon 20 Oct` → dialog with the code `XXXX-XXXX`, **Copy code** shows *Copied*, **Copy student instructions** copies a text with `http://localhost:3457` and the code. *(Story 1, T5)*
4. **Join** — `curl -X POST localhost:3457/api/v1/devs/register -H 'content-type: application/json' -H 'x-workshop-key: <code in lowercase>' -d '{"userId":"<uuid>","username":"lyon-dev"}'` → 201; the Lyon row shows *1 active / 1* and Delete is disabled (*Has 1 developer(s)*). A wrong key → 401. *(Story 2, Business Rules 1, 2, 5, T2)*
5. **Rotate** — **Regenerate code** → confirmation → new code; registering with the old code → 401, with the new one → 201; lyon-dev's existing token still posts events (202). *(Story 4, Business Rule 3)*
6. **Close / reopen** — **Close** → pill *Closed*, the workshop moves to the *Closed* group of the selector, registering → 401 *This workshop is closed*, events from lyon-dev → 202. **Reopen** → *Active*. *(Business Rule 4)*
7. **Delete** — create `Empty`, **Delete** → confirmation → gone; it disappears from the selector. Select it first in another tab, delete it, reload that tab: the selector shows *All workshops*. *(Business Rule 5, Edge Case "selected workshop was deleted")*
8. **Empty install** — on a fresh database without `WORKSHOP_KEY`, the overview shows *Create your first workshop* with a link to `/workshops`. *(Edge Case "no workshop exists yet")*
9. **Legacy** — on a database with developers, start with `WORKSHOP_KEY=abc-123`: `/workshops` lists *Default workshop* (*From WORKSHOP_KEY*) with every developer; `pnpm migrate:workshops` then prints *Nothing to do*. *(Story 5, Business Rule 9, T8)*
10. **FR and phone** — switch to FR at 375 px: every label of the Workshops page, dialogs and selector is French, and there is no horizontal scroll. *(UI / UX)*

Automated: `pnpm lint && pnpm typecheck && pnpm test` (41 tests; `tests/workshops.test.ts` covers Business Rules 1–10) and `pnpm build`.

## Dependencies

- **Blocked by**: `admin-dashboard-progress-tracking` (implemented): this feature extends its data model and API.
- **Blocks**: future per-workshop analytics and per-workshop trainer accounts.
- **External**: none new (MongoDB Atlas, Vercel, existing packages). The local dashboard (labs repository) needs no change.

## Out of Scope / Future Considerations

- Moving a developer to another workshop from the admin UI, and merging workshops.
- Per-workshop trainer accounts / SSO, so a co-trainer only sees their own sessions.
- Workshop dates, auto-close after an end date, and a QR code for the student instructions.
- Per-workshop lab subsets (which labs are in scope for this session).
- Per-workshop statistics page (completion rate, most failed lab, time to complete).

## Open Questions

> Closed on 2026-10-03 with the assumed defaults (the user said to start implementing, without Jira).

- [x] **Q1 — Re-registration with another code**: should the developer move to the new workshop (assumed, Business Rule 6) or be rejected so a developer belongs to one workshop forever?
- [x] **Q2 — Closing behavior**: should a closed workshop only block new registrations (assumed, Business Rule 4), or also reject the events of its developers?
- [x] **Q3 — Code format**: short 8-character code `XXXX-XXXX` that students can type (assumed), or a long random key that can only be pasted?
- [x] **Q4 — Legacy key**: keep reading `WORKSHOP_KEY` to create the Default workshop (assumed), or drop it entirely since the Atlas database is new and empty?
- [x] **Q5 — Jira**: the previous spec was tracked without Jira. Create an Epic + Tasks for this one, or keep it file-only? → file-only.
