## Why

Torii surfaces per-project status today, but two PMO-level views are missing: (1) a single comprehensive home for everything currently **at-risk** — with a weekly cadence of structured updates so the arc of a project is visible — and (2) an overall **timeline (Gantt-style)** that shows every project's phases against time, filtered to whatever slice the user cares about. Together they answer the two questions a delivery lead asks every Monday: "what's on fire, and how does the portfolio fall on the calendar?"

## What Changes

### New: weekly risk tracking + Risks page

- Add a `ProjectRiskUpdate` row per `(project, ISO week)` capturing **RAG level** (`Red`/`Amber`/`Green`), one or more **risk types** (`Technical`, `Relationship`, `Schedule`, `ExternalDependency`, `Gap`, `Resourcing`), **state** (`Blocked` or `Inform`), and free-text fields **description**, **go-to-green plan**, **latest update**, **next steps**, **action requested**. One update per project per ISO week (Monday-anchored); multiple writes during the same week update the same row.
- API:
  - `GET /api/risks` — list every project whose most recent update has `ragLevel != Green` (the "currently at-risk" projects), with this week's RAG, type(s), state, and a one-line title for each.
  - `GET /api/projects/:id/risk-updates` — full history (all weekly snapshots) for one project, newest first.
  - `POST /api/projects/:id/risk-updates` — upsert the current ISO week's update (PM only).
- Web `/risks` route, accessible to any authenticated user, rendering the list + a per-project drill-down with the current week prominently and previous weeks as collapsible cards. The current week's card also shows a **RAG arrow** (e.g., ▲ Amber → Red, or unchanged) comparing to the prior recorded week. PMs see an "Edit this week" form on the current-week card.

### New: Timeline (Gantt) page

- Web `/timeline` route. Renders a horizontal Gantt: time on the X axis (default 6 months centered on today, configurable by date filter), one row per project, each row a bar segmented by phase using the existing phase color palette. Project bar bounds are derived from `keyDates.kickoff` → effective hypercare end (with the same `actual_go_live` / `target_go_live + 4 weeks` defaulting we already use in the detail page). When `kickoff` is not set (the typical shape of Monday-imported projects), the bar starts 16 weeks before its computed end.
- Each project bar carries **milestone tick markers** for `keyDates.uat_start` (dashed amber — UAT phase boundary), `keyDates.target_go_live` (solid ink — the canonical target), and `keyDates.actual_go_live` (solid green — actually went live). The bar's left edge already represents the **project start** (`keyDates.kickoff`).
- Filters: **date range** (overlap with the visible window), **project type** (`direct` / `fintech` / `both`), **state**, **phase**, **person** (matches `Person.id == project.ownerId` OR any of `details.project_manager`/`solution_architect`/`solution_consultant` by display name).
- Default: render every project that has at least one of `target_go_live`/`actual_go_live`/`hypercare_end` set, no person/type/state/phase filter.
- Bar overlays:
  - **At-risk** indicator: a small RAG-colored dot when the project's most recent `ProjectRiskUpdate` has `ragLevel != Green`. Reads from the same data the Risks page uses.
  - **Over-budget** indicator: rendered behind a feature flag (`project.overBudget = false` for now). The slot is reserved so a future Harvest-integration change can light it up by setting that boolean.
- Add a `projectType` derived field on the project read API: `details.fintech_parent` set → `'fintech'`, otherwise `'direct'`. No new column.

### Modified: Phase enum overhaul (5 → 7 phases)

- Replace the 5-phase placeholder set (`Discovery`/`Build`/`UAT`/`Launch`/`Hypercare`) with the PortX PMO's actual 7-phase set: `Backlog`, `Initiation`, `Design`, `Development`, `UAT`, `GoLiveReadiness`, `Production`. Enum values are TypeScript- and Postgres-safe identifiers; a `phaseLabel()` helper supplies the display string for `GoLiveReadiness` ("Go-Live Readiness").
- DB migration `20260530100000_remap_phase_enum_7_phases` renames the legacy enum, creates the new one, and re-types `projects.phase` + both `phase_audit_log` columns with an explicit remap: `Discovery` → `Initiation`, `Build` → `Development`, `UAT` → `UAT`, `Launch` → `GoLiveReadiness`, `Hypercare` → `Production`. Existing values will be overwritten by the next Monday sync once `phase` becomes Monday-owned in a follow-up change.
- New-project default flips from `Discovery` to `Backlog` (the "committed but not yet started" entry).
- Auto-Done rule fires on advancing to `Production` (was `Hypercare`).
- New phase color palette in `Badge.tsx` and the Timeline `PHASE_BG`/`PHASE_FG` maps to match the prototype (slate / violet / magenta / cyan / green / amber / mint).

### Modified: Monday key-date extraction

- The Monday adapter extracts **every** scheduling column it can recognize on each item — not just `target_go_live` — using an exact column-title map: `Project Add Date` → `kickoff` (PMO intake — the kickoff event), `Project Start Date` → `project_start` (active delivery begins, distinct from kickoff), `UAT Start Date` → `uat_start`, `Baseline Go-live` → `baseline_go_live`, `Expected Go-Live Date` → `target_go_live`, `Actual Go-Live Date` → `actual_go_live`. This replaces the prior heuristic (column-id substring scan) that picked at most one date and missed UAT/actual/baseline entirely.
- The Monday adapter also extracts the project's **phase** from the "Project Phase" status column. Resolution: a leading `[N]` bracket prefix maps to the N-th `PHASES` entry (`[1]`→`Backlog`, …, `[7]`→`Production`); without a bracket, the value is matched case-insensitively against `phaseLabel(p)` for each enum value. Unrecognized values are dropped (the adapter never guesses).
- `ExternalProject` no longer carries `targetGoLive` as a single field — it now carries a `keyDates: Partial<{...}>` map plus an optional `phase` so adapters can surface multiple dates and the current phase at once. Default `field_mapping.phase` flips from `torii` to `monday`; PMs can pin the phase locally by overriding to `torii` per-project.
- Per-key field ownership in `DEFAULT_FIELD_MAPPING`: every Monday-sourced key date is `monday`-owned; `hypercare_end` stays `torii`-owned (no Monday source). The merge engine iterates `keyDates` entries and applies each per its own ownership.
- `KeyDatesSchema` extends to include three new optional keys: `project_start`, `uat_start`, `baseline_go_live`. `kickoff`'s semantics are clarified as PMO intake (Monday "Project Add Date") — the bar's left edge — while `project_start` is the start of active delivery and renders as a tick on the bar.

### Navigation

- Add **Risks** and **Timeline** entries to the NavShell, visible to all authenticated users.

## Capabilities

### New Capabilities
- `risk-tracking`: First-class weekly RAG cadence per project — schema, API, the Risks page, and the cross-cutting "is this project at-risk?" query used by the Timeline.

### Modified Capabilities
- `dashboard-views`: Adds the **Risks page** and the **Timeline page** as new requirements, and updates the navigation requirement to include them.
- `project-lifecycle`: Adds a derived `projectType` (`direct` | `fintech`) on the Project read shape, computed from `details.fintech_parent`. Extends `KeyDatesSchema` with three optional keys (`project_start`, `uat_start`, `baseline_go_live`). Replaces the 5-phase placeholder enum (`Discovery`/`Build`/`UAT`/`Launch`/`Hypercare`) with the 7-phase PMO set (`Backlog`/`Initiation`/`Design`/`Development`/`UAT`/`GoLiveReadiness`/`Production`); auto-Done rule shifts from `Hypercare` to `Production`. No new DB column — `key_dates` is JSON, `phase` keeps its column with a remapped enum type.
- `tracker-import`: Replaces the single-target heuristic with a six-key title-driven extraction. `ExternalProject.targetGoLive` is removed in favor of `ExternalProject.keyDates`. Per-key ownership flags are added for the new keys.

## Impact

- **New code**:
  - DB: `project_risk_updates` table + migration.
  - API: `apps/api/src/routes/risks.ts` (list at-risk), `apps/api/src/routes/risk-updates.ts` (per-project history + upsert), helpers for ISO-week math, project-type derivation in `serializeProject`.
  - Web: `apps/web/src/routes/risks.tsx`, `apps/web/src/routes/timeline.tsx`, supporting components for the Gantt bar and the weekly-card stack, NavShell entries.
  - Shared types: `RagLevel`, `RiskType`, `RiskState`, `ProjectRiskUpdate` types + Zod schemas.
- **APIs**: 3 new endpoints. List response gains derived `projectType`.
- **Schema**: 1 new table.
- **Dependencies**: none new (Gantt can be hand-rendered with CSS grid; no new chart library).

## Non-goals

- No Harvest integration; "over budget" indicator stays inert until a future change.
- No notifications/Slack alerts when a project transitions to Red.
- No PDF or CSV export of the risk register.
- No bulk-edit UI for weekly updates; each project's update is edited from its own card.
- No automatic close-out when a project goes Green for N weeks; the Risks page strictly reflects the most recent week's RAG.
- No retroactive editing of past weeks' updates in this change; only the **current** ISO week is editable (history is read-only).
- No cross-tenant or multi-org support; the existing single-tenant model is unchanged.

## Rollback plan

- Schema: the `project_risk_updates` table is additive; drop it to roll back. No data migration on `projects`.
- API: remove the three new routes and the `projectType` field from `serializeProject`. Additive change to the project read shape, so removing it doesn't break older clients.
- Web: revert the two new route files and the NavShell entries.

## Affected teams

- **PMO** — primary users for both pages. Weekly cadence of updates is a process change worth socializing alongside the rollout.
- **Engineering** — the timeline filter "person" includes plain-text team roles (PM/SA/SC) from `details`, which today are strings (not Person relations). Filter matches by case-insensitive substring on those values.
- **Platform / IT** — one nullable-column-free migration; no env or auth changes.
