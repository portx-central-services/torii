## Constraints

- Harvest's REST API (v2) is rate-limited to 100 requests / 15 seconds per access token. With ~200 active projects, a full bulk-snapshot refresh requires pacing.
- Every Harvest API request requires BOTH a bearer token AND an `Harvest-Account-Id` header. The account ID is returned in the OAuth callback alongside the access token; both are stored on `TrackerConnection`.
- Harvest project IDs are numeric strings (e.g., `39571483` from the Abrigo example URL). Stored as `TEXT` in `projects.harvest_project_id`.
- Harvest's API returns cost and invoicing data alongside hours. This change intentionally does NOT fetch, store, or display any monetary data (see D9). The Harvest workspace remains the source of truth for cost and invoicing visibility.
- The Harvest API does NOT expose "project manager" / "solution architect" / "senior consultant" as first-class fields — Harvest has a free-form "role on this project" string per user. Torii's role context lives in `details.project_manager` / `solution_architect` / `solution_consultant` (PMO-curated). The HarvestPanel's per-person role badges cross-reference Torii details by name match; they do not consume Harvest's free-form role string.

## Decisions

### D1 — Per-project Harvest link as a plain TEXT column, not as a second `tracker_ref`

`Project.trackerRef` is shaped `{ provider, externalId } | null` and is wired into the Monday merge engine, the import route, and the sync engine. Three options were considered:

- (a) Generalize `tracker_ref` to an array of refs.
- (b) Add a parallel `harvest_ref` JSON column with the same shape.
- (c) Add a plain `harvest_project_id` TEXT column.

**Chosen: (c).** The `tracker_ref` abstraction was designed for the Monday merge flow, where the external system is a source of truth for project metadata (name, dates, phase, details). Harvest's role is different — it's a read-only side-car for financial data. Forcing it into `TrackerRef` shape would require widening every Monday-only code path to handle "multiple refs" or "different ref shapes," which buys nothing today and complicates the merge engine. A future change that adds a third tracker can introduce the array form then.

### D2 — Snapshot in a separate table, not on `Project.harvest_snapshot` JSON

Three options:

- (a) JSON column on `projects`.
- (b) Dedicated `project_harvest_snapshots` table.
- (c) Per-task and per-person sub-tables.

**Chosen: (b).** The snapshot is ~10 scalar fields + a breakdown array, refreshed independently of the rest of the project row. Co-locating it on `projects` would bloat that row's UPDATE traffic on every Harvest sync (the Monday sync already updates `projects.tracker_raw`). A separate table makes the refresh a single-row UPSERT scoped to `(project_id)`. The per-(task, person) breakdown stays as `JSONB` within the snapshot row — querying it relationally (option c) buys nothing for the read pattern (always whole-snapshot reads).

### D3 — Strict over-budget rule, no per-project threshold

Per the user's choice: `overBudget = spent_hours > budget_hours`. No 90%-early-warning, no per-phase exemption, no per-project override. The chip is binary: in budget or not. A future change can add an "approaching budget" amber state if PMs want it.

When `budget_hours` is null or 0 (Harvest project has no budget set), `overBudget = false` — a project with no budget can't go over.

### D4 — NUMERIC(10,2) for hours; no monetary columns

NUMERIC(10,2) for hours preserves Harvest's 0.25h granularity. Hours fit comfortably in 10,2 (10 billion max — a project would need 4500 person-years to overflow). Per D9, no monetary fields are stored, so there are no `_cents` columns to worry about.

### D5 — Sync frequency: 30 min, matching Monday

Reuses the existing background scheduler. The Monday and Harvest syncs are independent — a Monday failure does not block Harvest, and vice versa.

### D6 — `overBudget` derived in `serializeProject`, not stored

Same pattern as the existing `projectType` derivation. Computing on read means we don't have a stale-value problem; the source of truth is the snapshot row's most recent `spent_hours` / `budget_hours`. The list endpoint LEFT JOINs `project_harvest_snapshots` so the derivation is one query, not N+1.

### D7 — Show-budget toggle is client-side state, not persisted

Like the existing date-range filter, the toggle is per-session UI state. No prefs storage. PMs who want budget visible by default can save a URL bookmark with `?showBudget=1` (URL-state persistence is a future change).

### D8 — Bulk-link UI: per-row dropdown, not name-fuzzy-match

The /trackers Harvest section lists every Harvest project; for each, an admin picks the matching Torii project from a dropdown (or "Skip"). No auto-match by name. Rationale: Harvest and Monday/Torii naming conventions differ ("[WO-03-1: Fiserv Premier FCO] Abrigo - Gulf Capital Bank..." in Harvest vs "Gulf Capital Bank - New Business - Platform" in Torii). Fuzzy matching would produce confident-but-wrong links that propagate into financial decisions. Manual link is slow but unambiguous. A future change can layer auto-match on top with confidence scores + admin batch-approval.

### D9 — No cost or invoicing data displayed or cached (hours-only)

The Harvest API returns Internal costs, Invoiced amount, Uninvoiced amount, Total project fees, and per-person cost on every project response. This change intentionally does NOT fetch, store, or display any of those fields. The HarvestPanel surfaces hours-only metrics (Total hours, Billable, Non-billable, Budget remaining); the per-(task, person) breakdown displays hours only with no cost column.

Rationale: cost and invoicing data is a separate access-control concern from PMO delivery signal. Keeping monetary data in Harvest avoids needing per-field role gates in Torii, simplifies the schema (no `_cents` columns, no monetary types in shared schemas), and keeps Torii's purpose tight: "what's the delivery effort against the budget?" — not "what's this project's P&L?"

`overBudget` is computed from HOURS (`spent_hours > budget_hours`), not from dollars. The OnBudgetChip percentage is hours-based.

A future change can lift this if a use case emerges. Note that lifting requires more than a UI toggle: the adapter has to start fetching cost fields, the snapshot schema must add `_cents` columns, the role-gating story has to be defined, and the breakdown JSON shape changes. None of which is in this change's scope.

### D10 — Bulk-refresh paces at 50 calls / 15 sec

Harvest rate-limits at 100 req / 15 sec. The bulk sync issues one `getProjectSnapshot()` call per linked project. With ~200 projects, naive parallel execution exceeds the limit. The engine issues calls in batches of 50 with a 15-second floor between batches, leaving headroom for any concurrent on-demand refreshes hit from the project detail page. Per-project on-demand refreshes are unbounded; rate-limit errors bubble up to the UI as 429.
