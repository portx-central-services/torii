## Why

The portfolio dashboard answers "how is the work going?" The customer page answers "how is this account doing?" The project page answers "how is this delivery doing?" Torii has no equivalent for the **people-side** question: **"who do I have, what are they on, and who has room?"**

The closest existing surface is `/capacity` (the team-week rollup), which is built for "are we over-staffed in week N?" not "what's Aaron's load right now?" And `/people/:id` answers it for one person at a time. There's no index — no way to scan the team in one read.

This change adds `/people` — an at-a-glance roster with the workload signals the team already maintains: committed %, availability %, billed hours over the last 30 days, plus an expander to show each person's current projects. The result is the missing entry point: "let me see who's free for the next engagement" becomes one page, not eight clicks across the existing detail pages.

## What Changes

### New page: `/people`

Renders a sortable table with one row per `Person`. Columns, left to right:

- **Name** — link to `/people/:id`.
- **Role** — `PM` or `Viewer` chip, with an `Admin` star when `isAdmin === true`.
- **Capacity** — composite cell: `<committed>% of <defaultCapacityPct>%`. `committed` is the sum of `weeklyPct` across the person's `person_project_capacities` rows. The numerator goes amber when `committed + availability > defaultCapacityPct` (over-committed), green when room remains, neutral when both are zero.
- **Available** — the person's self-reported `availabilityPct`.
- **30d billed** — sum of Harvest hours logged in the last 30 days (see "Schema" below). Renders as `—` when the person has no `harvest_user_id`. A small "as of" tooltip shows when the cache was last refreshed.
- **Active projects** — count + an expand control (▶). Expanding the row in place reveals each project: name (link), phase badge, `Current: N%` (self-reported), `Planned: N%` (active allocation pct), lifetime hours, variance chip.
- **Last reported** — relative time of the most recent `person_project_capacities.updatedAt` (e.g., "3 days ago", "—" when none).

Sort works on every column. Default sort: name ascending. Expanded state is local to the page session (not persisted).

The page is read-only — clicking a name navigates to `/people/:id` where editing happens (gated by self-or-admin per the previous change).

### Nav: insert **People** between Projects and Capacity

New order: Dashboard → Timeline → Risks → Customers → Projects → **People** → Capacity → Trackers. Visible to every authenticated user.

### Schema: cache 30-day billed hours on `Person`

Two new columns on `Person`:

- `billedHoursLast30d Decimal? @map("billed_hours_last_30d")` — sum of this person's Harvest entries with `spent_date ≥ today − 30d` at the time of the last sync. Null when the person isn't Harvest-linked OR the sync hasn't computed it yet.
- `billedHoursAsOf DateTime? @map("billed_hours_as_of")` — when the value above was last refreshed. Null until first sync.

The numbers are derived from the same `/time_entries` paged fetch the Harvest sync already performs per project. The sync engine gains a single aggregation pass that buckets entries by `user.id` and counts only those within the 30-day window, then upserts the resulting values on each `Person` whose `harvest_user_id` matches.

### New endpoint: `GET /api/people/overview`

Returns a list shaped for the index page directly. Response shape:

```ts
Array<{
  id: string;
  name: string;
  email: string;
  role: Role;
  isAdmin: boolean;
  harvestUserId: string | null;
  defaultCapacityPct: number;
  availabilityPct: number;
  committedPct: number;            // Σ weeklyPct across capacity rows
  billedHoursLast30d: number | null;
  billedHoursAsOf: string | null;   // ISO timestamp; null when never synced
  lastReportedAt: string | null;    // most recent person_project_capacities.updatedAt
  currentProjects: Array<{
    projectId: string;
    projectName: string;
    projectPhase: Phase;
    weeklyPct: number;
    allocatedPct: number;
    lifetimeHours: number | null;
    varianceBucket: 'green' | 'amber' | 'red' | 'neutral';
  }>;
}>
```

Accessible to any authenticated user. Internally calls the same workload-building logic the per-person endpoint uses, but in bulk and stripped to the fields the index needs.

### Out of scope (deferred — called out in spec non-goals)

- **Hiring / off-boarding workflows.** People rows are still managed via Monday sync; no add/edit affordances on this page.
- **Person photo or avatar.** Initials in a circle, same pattern as the existing nav.
- **Editable from the index.** Clicking a name navigates to `/people/:id` for the edit surface.
- **Per-week 30d trend / sparkline.** We surface the single 30d total; trend visualization is a follow-up.
- **Filters beyond sort.** No role / team / Harvest-linked filter chips. The table is small enough at our scale (~64 rows) that sort + browser find covers the use case.

## Capabilities

### Modified Capabilities

- `capacity-planning` — adds `Person.billedHoursLast30d` + `Person.billedHoursAsOf` columns, the bulk overview endpoint, and the sync-side aggregation that populates the new columns.
- `dashboard-views` — adds the `/people` index page; modifies the Navigation shell requirement to add People between Projects and Capacity.

## Impact

- **New code**: 2 new columns on `Person`, 1 new GET endpoint, 1 new page (`CustomersListPage`-style sortable table with a row expander), small CSS for the expander animation, and a few-line addition to the Harvest sync's time-entry loop.
- **DB**: 1 new migration. Two nullable columns on `people`. No backfill required (both null until first sync runs).
- **API contracts**: 1 new GET endpoint. Existing `/api/people` is unchanged.
- **Env**: no new env vars.
- **Dependencies**: no new packages.

## Non-goals

- No new permissions tier. The index reads what every authenticated user can already read.
- No write endpoints on this surface. Edits go through `/people/:id` and the existing workload PATCH.
- No real-time refresh of the 30d total. The Harvest sync cadence (already wired) is the refresh frequency.
- No "team / squad / pod" grouping. We have no team model in the schema and don't add one in this change.

## Rollback plan

Pure additive change. To roll back: drop the new endpoint, drop the new page + nav entry, drop the two new columns on `Person`. No existing data is rewritten.

## Affected teams

- **PMO + delivery leads** — primary users. The roster view is the missing piece between "what work do we have" (Projects) and "what does our week look like" (Capacity).
- **Individual contributors** — secondary readers. Seeing the team's loads alongside their own makes the self-reporting on `/people/:id` feel less isolated.
- **Platform / IT** — no infra changes. One small migration.
