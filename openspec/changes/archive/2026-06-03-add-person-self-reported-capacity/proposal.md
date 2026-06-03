## Why

Torii's capacity model today is **PM-owned**: the AllocationsPanel on `/projects/:id` is where the project manager records who's planned on what, and the per-Monday-project Reconciliation surface compares those plans to Harvest actuals. That's good for portfolio planning, but it leaves a real signal off the table — **what each person reports about their own current workload**.

A PM allocated Aaron at 50% to Project X based on the kickoff plan. Today, three weeks in, Aaron is actually spending 80% of his week on it. The allocation hasn't been rewritten because nobody flagged the drift, and the Harvest hours-spent figure only shows up after the fact. Right now there's no way for Aaron to say, in Torii, "my current week is 80% Project X, 10% Project Y, 10% support" — and no way for a PM to read that signal back out when staffing the next project.

This change adds a self-reported, per-person capacity layer on top of the existing allocation model. People own their own row of "right now I'm spending N% on each of these projects" and "I have X% of my week open for new work." It doesn't replace allocations (PMs still plan the formal commitment); it complements them, surfacing the lived-experience drift between plan and reality.

## What Changes

### `/people/:id` extends into the "user page" experience

The existing `/people/:id` route keeps its identity (no separate `/users/:id` page) but gains a **Workload** section that surfaces three things together:

1. The list of projects this person is currently working on — defined as `(active allocation) ∪ (non-zero self-reported weekly capacity)`. A project where the person has an active allocation but no self-report still appears; so does a project where they self-reported time but have no formal allocation.
2. For each project: the project name (link), the person's **current weekly capacity %** (editable on own page or by admin; read-only otherwise), lifetime Harvest hours (the existing reconciliation number), and the existing variance chip.
3. A single **"Availability for more work"** percentage at the top of the section — also editable in the same conditions.

When the viewer **is the person OR an admin**, all the percentages render as inline editors with immediate save. Otherwise the page renders the same data read-only — same numbers, no input affordances.

### New schema: per-(person, project) weekly capacity + per-person availability

Two additions:

- **`person_project_capacity`** table — composite primary key `(person_id, project_id)`, plus `weekly_pct` (integer 0–100), `created_at`, `updated_at`. One row per project the person is self-reporting time on. Zero rows for a person means "I have no current workload reported."
- **`Person.availability_pct`** column — integer 0–100, default 0, NOT NULL. The person's self-reported headroom: "of my baseline capacity (`defaultCapacityPct`), how much is open for new commits."

The model deliberately keeps these on the **person side**, not the project side. They're the person's view of their own week, and PMs read them; PMs don't write them (except as admins).

### New endpoints

- `GET /api/people/:id/workload` — returns `{ availabilityPct, defaultCapacityPct, projects: Array<{ projectId, projectName, projectPhase, projectState, weeklyPct, allocatedPct, lifetimeHours, varianceBucket }> }`. The `weeklyPct` is the self-reported value (or 0 when no row exists), `allocatedPct` is the sum of `Allocation.pct` for any *active* allocations (today between start and end) so the reader can see plan-vs-reported side by side.
- `PATCH /api/people/:id/workload` — body `{ availabilityPct?: number, projects?: Array<{ projectId: string, weeklyPct: number }> }`. Auth: self OR admin. Upserts the `person_project_capacity` rows; deletes rows whose `weeklyPct` is set to 0.
- The existing `/api/people/:id/reconciliation` keeps its shape (no change). The new workload endpoint subsumes and extends it for the UI; the reconciliation endpoint stays usable for other consumers.

### Permissions

- Edit affordances render only when `viewer.id === person.id` OR `viewer.isAdmin === true`.
- `PATCH /api/people/:id/workload` enforces the same rule server-side: 403 otherwise.
- Read access is unchanged — every authenticated user can view any other user's workload page.

### Validation

- Each `weeklyPct` and `availabilityPct` is `0 ≤ value ≤ 100`.
- We do NOT enforce that `Σ weeklyPct + availabilityPct ≤ defaultCapacityPct`. People's actual time rarely sums to 100, and a hard cap would surface as friction (the person edits one row, can't save because another row already exceeds the budget). Instead, the UI shows an **advisory line** beneath the table: `Σ reported: X% · availability: Y% · unaccounted: Z%`, where `Z = max(0, defaultCapacityPct - X - Y)`. When the sum exceeds `defaultCapacityPct`, the line goes amber and reads `over-committed by N%`. No mutation is blocked.

### Out of scope (deferred — called out in spec non-goals)

- **History / timeline of self-reports.** We store only the current value; no change log of "Aaron reported 80% last week, 60% this week." Future enhancement could add weekly snapshots.
- **PM workflows around self-reports.** No notifications when a self-report drifts far from the allocation. No PM-side dashboard of "who's over-committed." The signal lives on the person page; PMs find it by visiting.
- **Per-project person view.** No new component on `/projects/:id` showing each allocated person's self-report. The allocation table on the project page stays as-is; cross-referencing the person's self-report means clicking through to `/people/:id`.
- **Automatic decay.** A self-report from three months ago stays as-is until the person updates it. No "stale after N days" auto-clear.
- **Mobile-first input.** The inline editors are desktop-shaped (small numeric inputs with steppers). A future change can polish for mobile if usage warrants.

## Capabilities

### Modified Capabilities

- `capacity-planning` — adds `PersonProjectCapacity` entity, `Person.availabilityPct` field, and the per-person workload endpoint. The existing allocation/reconciliation requirements are unchanged.
- `dashboard-views` — extends the existing `Per-person view at /people/:id` requirement with the Workload section, the inline-edit behavior under self-or-admin conditions, and the advisory sum line.

## Impact

- **New code**: 1 new Prisma model (`PersonProjectCapacity`), 1 new column on `Person`, 1 new GET endpoint, 1 new PATCH endpoint, 1 new section on `/people/:id`, small CSS for inline-editor styling.
- **DB**: 1 new migration. New `person_project_capacities` table with FKs to `people` and `projects` (both cascade-delete). New `availability_pct` column on `people` (default 0, NOT NULL — backfills cleanly).
- **API contracts**: 2 new endpoints. Existing `/api/people/:id/reconciliation` and `/api/people/:id` are unchanged.
- **Env**: no new env vars.
- **Dependencies**: no new packages.

## Non-goals

- No new permission tier. "Self + admin" is implemented as `viewer.id === person.id || viewer.isAdmin`; no new role.
- No hard validation on the sum. Advisory only.
- No notification system on drift.
- No `Person.defaultCapacityPct` UX changes. That column already exists and is set elsewhere; this change reads it for the advisory line but doesn't move where it's edited.
- No `/users/:id` URL. The existing `/people/:id` keeps the canonical path.

## Rollback plan

Pure additive change. To roll back: drop the new endpoints, drop the new UI section, drop the `person_project_capacities` table, drop `Person.availability_pct`. No existing data is rewritten.

## Affected teams

- **Individual contributors** — primary users of the new edit affordances. The page now becomes the place to say "here's my week" in addition to the existing read-only roster view.
- **PMO** — primary readers. When staffing a new engagement, the person's workload page now answers "do they actually have room?" rather than just "is there an allocation slot open?"
- **Platform / IT** — no infra changes. One small migration.
