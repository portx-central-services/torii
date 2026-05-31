## 1. Shared types + validation

- [x] 1.1 Add enums in `packages/shared`: `RAG_LEVELS = ['Red','Amber','Green']`, `RISK_TYPES = ['Technical','Relationship','Schedule','ExternalDependency','Gap','Resourcing']`, `RISK_STATES = ['Blocked','Inform']`
- [x] 1.2 Add Zod schemas: `RagLevelSchema`, `RiskTypeSchema`, `RiskStateSchema`, `ProjectRiskUpdateOutSchema` (read shape), `ProjectRiskUpdateUpsertSchema` (write shape — non-empty `riskTypes`, free-text fields default empty)
- [x] 1.3 Export `PROJECT_TYPES = ['direct','fintech']` and a tiny `deriveProjectType(details)` helper

## 2. Schema + migration

- [x] 2.1 Add `ProjectRiskUpdate` Prisma model: `id`, `projectId`, `weekOf @db.Date`, `ragLevel` (enum), `riskTypes` (enum[]), `state` (enum), text fields with empty defaults, `authorId`, `createdAt`, `updatedAt`. Relations to `Project` (cascade) and `Person` (restrict)
- [x] 2.2 Add Postgres enums for `RagLevel`, `RiskType`, `RiskState`
- [x] 2.3 Add `@@unique([projectId, weekOf])` constraint and `@@index([weekOf])`
- [x] 2.4 Generate the migration SQL by hand under `apps/api/prisma/migrations/<ts>_add_project_risk_updates/`
- [x] 2.5 Regenerate Prisma client (`pnpm --filter @torii/api prisma:generate`)

## 3. API: ISO-week helper + project-type derivation

- [x] 3.1 Add `apps/api/src/lib/iso-week.ts` with `isoWeekMondayUTC(now = new Date()): Date` returning the Monday-00:00-UTC of the ISO week containing `now`, and `isSameIsoWeek(a, b): boolean`
- [x] 3.2 Update `serializeProject` to include `projectType` (derived from `details.fintech_parent`). Ensure list AND detail responses include it. Strip any `projectType` from `POST`/`PATCH` bodies (or document it as ignored)
- [x] 3.3 Update web `Project` type to include `projectType`

## 4. API: risk endpoints

- [x] 4.1 Add `apps/api/src/routes/risks.ts` with `GET /api/risks`: `DISTINCT ON (project_id) ORDER BY project_id, week_of DESC` → keep rows where `ragLevel != 'Green'` and `Project.state != 'Done'`. Serialize to include `{ projectId, name, weekOf, ragLevel, riskTypes, state, title }` where `title` is the first 120 chars of `description`
- [x] 4.2 Add `apps/api/src/routes/risk-updates.ts` with:
  - `GET /api/projects/:id/risk-updates` — list all updates for the project, newest first by `weekOf`
  - `POST /api/projects/:id/risk-updates` — PM-only, upsert by `(projectId, isoWeekMondayUTC(now))`. Reject any client-supplied `weekOf` that doesn't equal the current week's Monday. Set `authorId` from `request.user.id`
- [x] 4.3 Register both route modules in `app.ts`
- [x] 4.4 Vitest: at-risk listing (excludes Greens and Done), history read (newest first), upsert (creates first time, updates second time in same week), week mismatch rejection, non-PM forbidden, unauth 401

## 5. Web API client + types

- [x] 5.1 Add `ProjectRiskUpdate` type and `RiskListItem` type to `apps/web/src/api/endpoints.ts`
- [x] 5.2 Add endpoint helpers: `listRisks()`, `getProjectRiskUpdates(projectId)`, `upsertProjectRiskUpdate(projectId, body)`
- [x] 5.3 Expose `PROJECT_TYPES` and the `projectType` field on `Project`

## 6. Navigation

- [x] 6.1 Add `Risks` and `Timeline` `NavLink` entries to `apps/web/src/components/NavShell.tsx`, visible to all authenticated users (above `Trackers`)

## 7. Risks page

- [x] 7.1 Add `apps/web/src/routes/risks.tsx` route component; wire `/risks` into `App.tsx`
- [x] 7.2 Page layout: top summary (counts of Red / Amber / total), then one section-card per at-risk project
- [x] 7.3 Each card renders the **current ISO week's** full record: RAG chip + arrow vs prior, risk-type tag list, state badge, description, go-to-green plan, latest update, next steps, action requested, plus "last updated by {author} at {time}"
- [x] 7.4 Below the current-week card render a collapsible "Previous weeks" disclosure; expanding lists prior `ProjectRiskUpdate` rows (newest first) each in its own collapsed/expandable summary
- [x] 7.5 PM-only: an "Edit this week" action that opens an inline form (or modal) with RAG / types (checkbox) / state / four text areas, POSTs to the upsert endpoint, invalidates the queries
- [x] 7.6 Empty state when no projects are at-risk
- [x] 7.7 RAG arrow component: take `(current, previous)` and render ▲/▼/= with the right color

## 8. Timeline page

- [x] 8.1 Add `apps/web/src/routes/timeline.tsx` route component; wire `/timeline` into `App.tsx`
- [x] 8.2 Date helpers: `monthsBetween(from, to)`, `barGeometry(project, range) → { leftPct, widthPct }`
- [x] 8.3 Page layout: filter bar (date range, project type, state(s), phase(s), person substring) above a Gantt grid (CSS-grid based, header row of month labels, one row per project)
- [x] 8.4 Render each project bar in its phase color (reuse the existing palette in `Badge.tsx`); add a vertical tick at `target_go_live` when set
- [x] 8.5 At-risk overlay: pull the at-risk map from `listRisks()`; render a small RAG-colored dot on bars for at-risk projects
- [x] 8.6 Over-budget overlay: render a small icon when `project.overBudget === true`. Reads from a field that defaults `false` (the field can stay client-side mock until a future change)
- [x] 8.7 Bar click navigates to `/projects/{id}`
- [x] 8.8 Project-type and person filters apply client-side over the fetched list

## 8a. Monday key-date extraction (multi-key)

- [x] 8a.1 Extend `KeyDatesSchema` in `packages/shared/src/schemas.ts` with optional `project_add_date`, `uat_start`, `baseline_go_live` (yyyy-mm-dd)
- [x] 8a.2 Extend web `Project.keyDates` type in `apps/web/src/api/endpoints.ts` with the three new keys
- [x] 8a.3 Replace `ExternalProject.targetGoLive` with `ExternalProject.keyDates: Partial<{...}>` in `packages/shared/src/tracker-adapter.ts`
- [x] 8a.4 Add Monday-owned default ownership for every imported key date (`key_dates.project_add_date`/`kickoff`/`uat_start`/`baseline_go_live`/`target_go_live`/`actual_go_live`) in `DEFAULT_FIELD_MAPPING`; keep `key_dates.hypercare_end` Torii-owned
- [x] 8a.5 Add `MONDAY_KEY_DATE_TITLE_MAP` + `extractKeyDates()` in `MondayAdapter.ts`; remove the heuristic `extractTargetGoLive`
- [x] 8a.6 Update `mergeExternalIntoTorii` to iterate `external.keyDates` entries with per-key ownership
- [x] 8a.7 Update the tracker-import route's per-item create/update path in `apps/api/src/routes/tracker.ts` to seed `newKeyDateFields` from `external.keyDates`
- [x] 8a.8 Render UAT-start and actual-go-live tick markers on Timeline bars alongside the target tick (with CSS styles for each)
- [x] 8a.9 Update adapter tests to use the title map (every key-date column extracted in one pass; unrecognized titles ignored; no `keyDates` when none present)
- [x] 8a.10 Update merge-fields tests for multi-key behavior (every Monday-owned date applied; per-key Torii override doesn't block other keys)
- [x] 8a.11 Update sync-engine tests to pass `keyDates: {...}` on `ExternalProject` fixtures

## 8b. Phase enum overhaul (5 → 7 phases)

- [x] 8b.1 Replace `PHASES` in `packages/shared/src/enums.ts` with the 7-phase set; add `PHASE_LABELS` + `phaseLabel()` helper for the `GoLiveReadiness` → "Go-Live Readiness" display mapping
- [x] 8b.2 Update `Phase` enum in `apps/api/prisma/schema.prisma` and flip the column default to `Backlog`
- [x] 8b.3 Write migration `20260530100000_remap_phase_enum_7_phases`: rename old enum, create new, re-type `projects.phase` and both `phase_audit_log` columns with the explicit Discovery→Initiation / Build→Development / UAT→UAT / Launch→GoLiveReadiness / Hypercare→Production remap; drop the old enum
- [x] 8b.4 Regenerate Prisma client (`pnpm --filter @torii/api prisma:generate`)
- [x] 8b.5 Update `apps/api/src/routes/projects.ts`: default `phase` on create from `Discovery` to `Backlog`; auto-Done rule fires on `Production` (was `Hypercare`)
- [x] 8b.6 Update `apps/web/src/components/Badge.tsx` with the new 7-color phase palette + use `phaseLabel()` for display text
- [x] 8b.7 Update `PHASE_BG`/`PHASE_FG` in `apps/web/src/routes/timeline.tsx` to the prototype's saturated 7-phase palette (slate / violet / magenta / cyan / green / amber / mint); render `phaseLabel(p.phase)` on the bar
- [x] 8b.8 Use `phaseLabel()` in phase dropdowns: `projects-list.tsx` (filter + create form), `project-detail.tsx`, timeline phase segmented control
- [x] 8b.9 Flip the default phase in the project-create form (`projects-list.tsx`) from `Discovery` to `Backlog`
- [x] 8b.10 Remap phase literals in test fixtures (`projects.test.ts`, `allocations.test.ts`, `sync-engine.test.ts`) to the new enum values
- [x] 8b.11 Apply the migration to the dev DB and verify the phase distribution shifted as expected

## 8c. Monday-sourced phase

- [x] 8c.1 Add `phase?: Phase` to `ExternalProject` in `packages/shared/src/tracker-adapter.ts`
- [x] 8c.2 Flip `phase` ownership in `DEFAULT_FIELD_MAPPING` from `torii` to `monday`
- [x] 8c.3 Implement `extractPhase()` in `MondayAdapter`: read the "Project Phase" column; resolve by `[N]` bracket index first, fall back to case-insensitive label match; return undefined when unresolvable (don't guess)
- [x] 8c.4 Extend `ExistingProjectSlice` and `MergePatch` with `phase`; merge engine applies it under the same ownership rules as `name`
- [x] 8c.5 Thread `phase` through all three engine call sites in `apps/api/src/sync/engine.ts` (bulk sync, force-refresh-linked, single project) — read from `project.phase`, write `phase` when `patch.phase !== undefined`
- [x] 8c.6 Tracker import route seeds `phase` on create AND on overwrite when the adapter returned one
- [x] 8c.7 Tests: adapter — bracketed label resolves by index; non-bracketed label resolves by display name; unrecognized label omits phase
- [x] 8c.8 Tests: merge — default adopts external phase, undefined external is a no-op, per-project `phase: 'torii'` override blocks, matching phase is a no-op
- [x] 8c.9 Verify the 201 `Initiation` placeholders shift to their real Monday phases after the next sync (manual)

## 8d. Timeline geometry to match the prototype

- [x] 8d.1 Rewrite `projectBounds(project, range)` in `apps/web/src/routes/timeline.tsx`: start = `project_start` ?? `range.from`, end = `target_go_live` ?? `range.to`; never return null (always render)
- [x] 8d.2 Return `clippedLeft` / `clippedRight` booleans (true iff the real date exists and lies outside the visible window) and apply them as bar CSS classes
- [x] 8d.3 Drop the four milestone tick elements (`project_start`, `uat_start`, `target_go_live`, `actual_go_live`) and their corresponding CSS rules
- [x] 8d.4 Update the visibility filter: hide a project only when its real `project_start` is strictly after the window OR its real `target_go_live` is strictly before the window (projects with at least one missing endpoint always overlap)
- [x] 8d.5 Render a vertical "today" line inside `.timeline-rows` when today falls inside the visible window, offset by the 232px label-column width
- [x] 8d.6 Drop the dead `addWeeksISO` helper (no longer used after the hypercare-extension logic was removed)
- [x] 8d.7 Verify: web typecheck + build clean; the prototype's "always render, dashed when clipped" geometry is in effect

## 8e. Filters, views & KPIs

- [x] 8e.1 Add `deriveStage(project)` helper in `apps/web/src/routes/timeline.tsx`: `phase === 'Backlog' → 'Committed'`, else `'Active'`. Document the Initiation-not-started edge case as a known approximation
- [x] 8e.2 Add `collectPeople(projects)` and `projectRoleEntries(project)` helpers for the person dropdown and by-person grouping
- [x] 8e.3 Restructure `Filters` type: add `stage`, `role` (`'' | RoleKey`), `view` (`'project' | 'person'`); change `person` from substring to exact match
- [x] 8e.4 Update visibility filter: person+role strict; person-only matches any role; role-only requires anyone in that role; stage applied per-project
- [x] 8e.5 Compute filtered-set KPI counts: projects, distinct people, Active count, In UAT/Go-Live, In Development, In Backlog/Init
- [x] 8e.6 Render `<KpiStrip>` above the filter row using the existing `section-card` shell
- [x] 8e.7 Extract `<BarRow>` so it can be shared between by-project and by-person rendering; accept an optional `roleBadge` for the by-person case
- [x] 8e.8 Implement by-person grouping: walk visible projects, emit one `(person, role)` entry per role assignment, group by person alphabetically with rows sorted by bar start
- [x] 8e.9 Filter UI: add View toggle (segmented), Stage select, Person select (populated from `collectPeople`), Role select; remove the old free-text person input
- [x] 8e.10 CSS: `.timeline-kpis` grid, `.timeline-kpi*`, `.timeline-person-group` + `.timeline-person-header` + `.timeline-person-count`, `.timeline-role-badge`, `.timeline-row-label-text`

## 8f. Fix stale per-project field_mapping snapshots blocking phase sync

- [x] 8f.1 Write migration `20260530120000_fix_phase_ownership_on_existing_rows`: flip stored `field_mapping.phase = 'torii'` to `'monday'` on existing rows so the merge engine no longer blocks the Monday-sourced phase update
- [x] 8f.2 Apply the migration to dev DB and verify (201 rows flipped, no stragglers)
- [x] 8f.3 Refactor `apps/api/src/routes/tracker.ts` import path: store `fieldMapping: {}` instead of snapshotting `DEFAULT_FIELD_MAPPING`. Per-project overrides still live in the JSON column if/when set; defaults are read from the current `DEFAULT_FIELD_MAPPING` at sync time. Prevents this bug from recurring on the next ownership-default change
- [x] 8f.4 Drop the now-unused `DEFAULT_FIELD_MAPPING` import in `tracker.ts`
- [x] 8f.5 Trigger a connection refresh from `/trackers` (or wait for the scheduled 30-min sync) and confirm phases shift from `Initiation` placeholder to real Monday-sourced values

## 9. Verification

- [x] 9.1 `pnpm --filter @torii/api test` green
- [x] 9.2 `pnpm --filter @torii/web exec tsc --noEmit` clean
- [x] 9.3 `pnpm --filter @torii/web build` succeeds
- [x] 9.4 Apply the migration in a dev DB; verify the enums and the `project_risk_updates` table + unique index
- [x] 9.5 Manually: as PM, write a risk update on `/risks` for a real project, refresh — confirm it shows under the current week with a "now" timestamp; write a different RAG value, save — confirm the same row updates (no second row)
- [x] 9.6 Manually: as Viewer, confirm no edit affordances on `/risks` and that the history disclosure renders
- [x] 9.7 Manually: on `/timeline`, verify default 6-month window, phase colors, target-go-live tick, and a clicked bar navigates to detail
- [x] 9.8 Manually: apply each filter (date range, project type, state, phase, person) and verify the row set narrows accordingly
- [x] 9.9 Manually: confirm the at-risk dot appears on bars for projects from `GET /api/risks`, and that the over-budget overlay does NOT appear (since the flag defaults `false`)
