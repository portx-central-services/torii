## Why

Today Torii stores Project Manager, Solution Architect, and Senior Consultant as **free-form strings** in `projects.details` (JSONB). The same human — "Aaron Levy" — appears as a separate string on every project he's on, with no foreign-key relationship to the `Person` table. As a result:

- There is no "show me every project Aaron is on across roles" view.
- The planned allocations (`Allocation.personId` → `Person.id`) and the role assignments (`details.project_manager` string) never reconcile, even though they describe the same human.
- The Harvest snapshot's per-(task, person) breakdown can't be cross-walked to Torii allocations — they're strings on one side and integers on the other.
- Filters like "person" on Timeline and Risks rely on case-insensitive substring matching, which silently produces wrong results when two people share a partial name.

This change **promotes the three role fields to first-class foreign keys on `projects`**, with a one-shot data migration that creates / matches Person rows for every name already in `details`. It also lays in the **Harvest user-ID bridge on Person** that the next change (#1 — Allocations ↔ Actuals reconciliation) needs to do its join.

This is plumbing. The user-facing UX is unchanged in spirit — the same names render in the same places — but underneath every reference is now a Person, and `/people/:id` becomes a real page.

## What Changes

### Schema

- Add three nullable FK columns on `projects`:
  - `project_manager_id` → `people.id`, `ON DELETE SET NULL`
  - `solution_architect_id` → `people.id`, `ON DELETE SET NULL`
  - `solution_consultant_id` → `people.id`, `ON DELETE SET NULL` (column name keeps the legacy storage key — display label remains "Senior Consultant" per the prior change)
- Add `harvest_user_id TEXT NULL UNIQUE` on `people`. Bridges to Harvest's numeric user ID for the next change.
- The existing string fields in `details` (`project_manager`, `solution_architect`, `solution_consultant`) **stay** as the immutable Monday-extracted history — the FK is the canonical Torii reference; the string is the fallback when no FK is set yet.

### Person identity story

`Person` currently requires a unique `email`. Monday-extracted names don't carry emails, so the migration creates new Person rows with a **synthetic email** of the form `<name-slug>@torii.unresolved` (using `.unresolved` so it can never collide with a real DNS-resolvable domain). Admins can later reconcile these with real SSO-authenticated Person rows; this change does not block on that reconciliation.

A future change can introduce a richer model (separate Contact table, source enum) — keeping this change scoped to the FK plumbing.

### One-shot data migration

For each existing project, for each of (`project_manager`, `solution_architect`, `solution_consultant`):

1. Read the string from `details`.
2. Look up `Person` by case-insensitive name match.
3. If found → set the FK column on the project to that Person's id.
4. If not found → create a new Person with the name, synthetic email, `role=Viewer`, `defaultCapacityPct=100`; set the FK to the new id.
5. Leave the original string in `details` untouched (it remains the immutable Monday-sourced value).

### Monday adapter post-extraction resolution

After `MondayAdapter.extractDetails` populates the string fields on `ExternalProject.details`, the sync engine runs a **person resolution step**: for each of the three role-string fields, repeat the same upsert-by-name logic above and write the resolved Person id onto the project row. This keeps the extractor itself string-pure and isolates the Person logic in one place.

### API surface

`serializeProject` now returns three resolved Person objects on the project read shape:

- `projectManager: PersonOut | null`
- `solutionArchitect: PersonOut | null`
- `solutionConsultant: PersonOut | null`

These are populated via Prisma `include` against the new FKs. When the FK is null (e.g., a project Torii couldn't auto-resolve the name for, or a project where the Monday string is empty), the field is null and the UI falls back to the raw `details` string.

New endpoint: `GET /api/people/:id/projects` returns every project this Person is on across all three roles AND via `Project.ownerId`. Includes the role designation per project so the UI can render badges.

### UI

- **Project detail page** — the three role rows display `Person.name` when the FK is set (with a link to `/people/:id`), the raw string otherwise.
- **Projects list** — the three role columns render Person.name with link; sort + search both still work.
- **Timeline person filter** — now an explicit Person dropdown (driven by `GET /api/people`) instead of substring matching. The filter applies to all three role FKs + the project owner.
- **Risks page filters** — same Person-FK-based filter.
- **New `/people/:id` view** — header with the person's name + role + sign-in status; a section listing every project they're on, grouped by role (PM / SA / SC / Owner), with project name + current phase + current state + over-budget chip.

### Out-of-scope (deferred)

- Auto-linking Harvest user IDs to Person rows. The `harvest_user_id` column lands here; populating it is part of #1.
- PTO / availability modeling (`Person.is_active` etc.).
- Removing the legacy string fields from `details`. Kept indefinitely as immutable Monday-extracted history.
- Person reconciliation UI (merging duplicate Person rows). Will be needed eventually if synthetic-email people meet their real SSO counterpart; deferring until it bites.
- Renaming the `solution_consultant_id` storage-key column to `senior_consultant_id`. Display label stays "Senior Consultant" per the prior change; storage-key consistency wins here.

## Capabilities

### Modified Capabilities

- `project-lifecycle` — Project read shape gains three resolved Person fields; UI consumers prefer Person.name when present, fall back to the legacy string.
- `tracker-import` — Monday sync runs a post-extraction person-resolution step that upserts Person rows and sets the FKs on the project.
- `dashboard-views` — Timeline and Risks person filters switch from substring match to Person FK; project detail + projects list display Person.name when FK is set; new `/people/:id` view.

## Impact

- **New code**: schema migration; resolver utility (used by both the one-shot data migration and the Monday sync); new endpoint + new route + new view.
- **DB**: 3 new nullable FK columns on `projects`; 1 new column on `people` (`harvest_user_id`); one data-migration step.
- **API**: project read response gains 3 fields; one new endpoint (`GET /api/people/:id/projects`).
- **Env**: no new env vars.
- **Dependencies**: no new packages.

## Non-goals

- No removing the legacy `details` string fields. They stay as the immutable Monday-extracted history.
- No fuzzy name matching during resolution — case-insensitive exact match only. False positives in finance-adjacent data are worse than asking an admin to deduplicate.
- No new Person creation UI in this change. New Person rows come from (a) the existing SSO sign-in flow and (b) the migration / Monday-sync upsert path.
- No bulk merge UI for deduplicating synthetic-email Persons against real SSO Persons. Add this later if it actually causes problems.
- No reverse-link from the existing `Allocation.personId` → `Person` to projects via role (that's part of #1).

## Rollback plan

- Schema: drop the 3 new FK columns on `projects` and the `harvest_user_id` column on `people`. Additive only — no data in the existing tables is modified by this migration except the new column values.
- API: revert `serializeProject` to omit the resolved Person fields; remove the new endpoint.
- UI: revert the consumers to read raw `details` strings.
- The auto-created synthetic-email Person rows can stay (harmless) or be cleaned up via a one-shot query.

## Affected teams

- **PMO** — `/people/:id` becomes a real page; the person filter on Timeline and Risks now matches deterministically (no more "Sam" picking up everyone whose name starts with Sam).
- **Engineering** — sets up the Person-bridge that change #1 (Allocations ↔ Actuals) joins through.
- **Platform / IT** — one data-migration step that creates Person rows for every distinct name in the existing `details`. The synthetic emails (`@torii.unresolved`) are documented as non-deliverable.
