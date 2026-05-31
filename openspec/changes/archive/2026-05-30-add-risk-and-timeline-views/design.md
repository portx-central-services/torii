## Context

Two PMO-level views are missing today. The current detail page covers one project at a time; the projects list is a flat tabular view filtered by phase/state/owner. Neither answers "what's burning right now?" or "how does the portfolio fall on the calendar?". This change introduces a first-class weekly risk cadence and a Gantt-style portfolio timeline. The risk model is the bigger data lift; the timeline is mostly UI built on existing project data plus a small at-risk lookup.

The two views are bundled into one change because the timeline depends on the risk model for its at-risk indicator — splitting them would create an awkward dependency.

## Goals / Non-Goals

**Goals:**
- A `(project, ISO week)` snapshot model for weekly RAG cadence with full audit history.
- A Risks page that surfaces every currently-at-risk project with this week prominently and previous weeks as drill-down.
- A Timeline page that renders the portfolio as a horizontal Gantt with the existing phase palette and filters.
- Read-only "at-risk" and "over-budget" overlays on Timeline bars — the latter wired up but inert until a future Harvest integration sets the flag.
- Derived `projectType` (`direct` | `fintech`) on the project read API; no new column.

**Non-Goals:**
- Harvest integration, notifications, exports, bulk edit, retroactive history edits, person-relation fields for the team roles, cross-tenant support.

## Decisions

### Risk model: weekly snapshot table, ISO-week anchored

New table `project_risk_updates`:

```
project_risk_updates
  id            cuid pk
  project_id    fk -> projects(id) on delete cascade
  week_of       date (Monday of the ISO week)
  rag_level     enum  Red | Amber | Green
  risk_types    enum[] subset of { Technical, Relationship, Schedule, ExternalDependency, Gap, Resourcing }
  state         enum  Blocked | Inform
  description       text default ''
  go_to_green_plan  text default ''
  latest_update     text default ''
  next_steps        text default ''
  action_requested  text default ''
  author_id     fk -> people(id) (the PM who last wrote it)
  created_at    timestamp
  updated_at    timestamp

  unique (project_id, week_of)
  index  (week_of desc)
```

The `(project_id, week_of)` unique constraint enforces one snapshot per project per ISO week — re-saves during the week update the same row. Past weeks become immutable in the API (only the current ISO week is writable in this change).

`riskTypes` as a Postgres `text[]` of enum values, simple to extend without a migration. Storing as enum array is convenient and keeps queries simple.

ISO week anchor: Monday at 00:00 UTC. A small `isoWeekOf(date)` helper returns the Monday for any timestamp.

### Authorization

- Read endpoints (`GET /api/risks`, `GET /api/projects/:id/risk-updates`): any authenticated user (Viewer + PM).
- Write endpoint (`POST /api/projects/:id/risk-updates`): PM only. The current ISO week is the only one the API accepts to upsert (passing any other `weekOf` returns 400).

### "Currently at-risk" definition

A project is currently at-risk if its **most recent** `project_risk_updates` row has `rag_level != Green`. A project that has never had a risk update is not at-risk by definition. The list endpoint (`GET /api/risks`) does this via a window query — `DISTINCT ON (project_id) ORDER BY project_id, week_of DESC` — and filters out Green.

The Timeline page uses the same definition via a small joined query that returns `{ projectId → ragLevel }` for the visible projects.

### RAG arrow (week-over-week delta)

For the prominent current-week card, render a small arrow showing how the level changed vs the most recent **prior** week's update (skipping gaps). The arrow is decorative — the data is `current.ragLevel` vs `previousNonCurrent.ragLevel`. If there's no prior update at all, no arrow.

### Risks page UX

- Top: a header summary (counts: Red / Amber, total at-risk).
- Body: one card per at-risk project. Each card renders the current ISO week's full record (RAG + arrow, type tags, state badge, description, go-to-green, latest update, next steps, action requested).
- Below the current-week card: a "Previous weeks" disclosure that lists prior updates as collapsed cards (week of … RAG Red), expandable to see the same fields.
- For PMs: an "Edit this week" affordance on the current-week card opens an inline form (or modal) to upsert. Only the current ISO week is editable.

### Timeline page: hand-rolled Gantt using CSS grid

A new chart library would be overkill. Render approach:

- The page computes a `visibleRange = [from, to]` from the date filter (defaults to today−2mo .. today+4mo).
- The grid:
  - One header row with month labels stretching across the range.
  - One row per filtered project. Each row is a single grid track. Within the track, a flex container holds the project's bar — left-margin computed from `(kickoff - from) / totalDuration` as a percentage, width from `(effectiveHypercareEnd - kickoff) / totalDuration`.
  - The bar is itself a horizontal flex of phase segments. Each segment's width is its share of the project's known phase boundaries; for phases without explicit boundaries (we only have key dates, not phase-by-phase dates), we evenly distribute remaining phase segments between known key dates. See "Phase segmentation" below.
- Hover any bar to see the project name + go-live date in a tooltip.
- Click a bar to navigate to the project detail.

The whole grid is CSS-positioned; no SVG, no chart library. Fits comfortably in `apps/web/src/routes/timeline.tsx` with a Gantt helper module that does the math.

#### Phase segmentation

We have `keyDates.kickoff`, `target_go_live`, `actual_go_live`, `hypercare_end`. We don't have per-phase boundaries (Discovery → Build → UAT → Launch boundaries). Decision: render the bar as a single colored segment using the project's **current phase** color, with the bar's left edge at `kickoff` and right edge at `effectiveHypercareEnd` (using the same default we use on the detail page: `actual_go_live + 4w` or `target_go_live + 4w`). Show a vertical tick marker at `target_go_live` if set. This is simpler than synthesizing per-phase boundaries we don't have and still surfaces the right schedule signals.

We can revisit per-phase segmentation later if phase transitions get explicit dates (e.g., a new `phase_transitioned_at` row in the existing `phase_audit_log`).

### Project type derivation

`projectType` is derived **server-side** in `serializeProject`:

```ts
projectType: project.details?.fintech_parent ? 'fintech' : 'direct'
```

Exposed in both the list and detail responses. The Timeline filter accepts `?projectType=direct|fintech|both` (default `both`). No persisted column; entirely a computed field.

### Person filter on Timeline

The "person" filter accepts a substring and matches case-insensitively against (`Person.name` of `Project.owner_id`, `details.project_manager`, `details.solution_architect`, `details.solution_consultant`). This is a UI-side filter on the already-fetched project list — no server-side person query. Acceptable because the project list is bounded.

### Navigation

Add **Risks** and **Timeline** entries to NavShell. Visible to all authenticated users; no role gating. (PM-edit on the Risks page enforces role inside the page.)

## Sequence (PM writes this week's risk update)

```
PM clicks "Edit this week" on a project's current-week card
  ↓
Inline form submits POST /api/projects/:id/risk-updates with the form fields
  ↓
API checks PM role, computes isoWeekOf(now) — passes if request.weekOf matches
  ↓
Prisma upsert on (project_id, week_of) — creates or updates
  ↓
Returns updated record; UI invalidates the project's risk-updates query
```

## Risks / Trade-offs

- **One-snapshot-per-week is a soft constraint** — if a PM writes Monday and re-writes Friday, the Friday entry overwrites Monday. Acceptable for the workflow (PMs treat the week's entry as a living doc). Mitigation: `updated_at` reflects last write; UI shows "last updated by … at …" on the current card.
- **At-risk lookup performance** — `DISTINCT ON` over `project_risk_updates` is O(rows) per request. Fine at portfolio scale (hundreds of projects, weekly cadence ≈ a few thousand rows). Add a partial index on `(project_id, week_of DESC)` if it ever becomes hot.
- **Gantt math is hand-rolled** — small risk of off-by-one in date arithmetic, especially around DST and month boundaries. Mitigation: use UTC-day math (we already have `addWeeks` from the previous detail-page change); a small unit test covers `from/to` and a sample project's bar geometry.
- **Project-type derivation is fragile** — relies on `details.fintech_parent` being non-empty as the signal for "fintech". If a PM types whitespace, it counts. Mitigation: derive on the trimmed value: `Boolean(details.fintech_parent?.trim())`.
- **Person filter is shallow** — matches by display name as a substring. Risk of false positives if two people share a name fragment. Acceptable for the PMO scale; a future "PM/SA/SC as Person relations" change replaces this with proper id-based filtering.
- **Over-budget overlay is dead UI** — visible but inert until Harvest lands. Mitigation: the field `project.overBudget` defaults to `false` and the overlay renders only when `true`, so today it's invisible. The slot exists in the spec and the renderer so the next change is a 1-line wire-up.

## Migration plan

1. Apply migration (`project_risk_updates` table, FKs, unique constraint, index).
2. Deploy API + web together. Both routes are additive; old clients are unaffected.
3. Communicate to PMs that the Risks page is the new home for weekly updates and the Timeline shows everything the projects list does plus schedule.
4. Rollback: drop the new table, revert the two routes + the `projectType` field, revert the web routes + NavShell entries.

## Open Questions

- **Wider portfolio's worth of risk types** — the six listed are fine for now. If product wants to add more (e.g., "Customer commitment", "Vendor"), it's an enum migration (or move to a tag-string set if we expect frequent additions).
- **At-risk = "ragLevel != Green" or "state == Blocked"?** Currently using the former. A "Blocked but Green" entry would be filtered out of the Risks page even though "Blocked" is a strong signal. Acceptable for v1; revisit if Blocked-without-Red appears in practice.
- **What about projects in `Done` state?** Excluded from the Risks page (a Done project shouldn't have at-risk weekly updates). Timeline still shows them when their date range intersects the visible window — they're part of the historical record.
