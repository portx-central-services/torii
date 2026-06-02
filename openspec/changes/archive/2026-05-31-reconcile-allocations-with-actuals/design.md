## Constraints

- The cached Harvest snapshot is **project-lifetime totals**, not weekly. The `breakdown` JSONB records total `hours` per (task, person) across the project's whole history. Weekly granularity isn't available without a separate per-week sync against `/v2/time_entries`.
- Allocations are stored as percent over a date range, not as hours. Converting to hours requires choosing a "full capacity" assumption — Torii uses **40 hours per week × `Person.defaultCapacityPct%`**.
- `Person.harvest_user_id` exists from #3 but is **never auto-populated**. The bridge has to be set manually by an admin, or the reconciliation can't render.
- `defaultCapacityPct` is the static, person-level default. There's no time-windowed override (no PTO model, no "Aaron is at 80% in March"). Reconciliation respects only the static default.

## Decisions

### D1 — Lifetime totals only; weekly is a future change

The minimum that delivers the planned-vs-actual join is **project-lifetime totals**. The Harvest snapshot already stores this. A useful answer to "is the team doing what we planned" emerges immediately — "Aaron is allocated 200h on Project X, has logged 50h after 3 months" is a strong PMO signal.

Weekly granularity is genuinely more useful for capacity questions ("is anyone over-allocated *this week*"), but it requires a separate per-week time-entries sync, a new cache table, and a substantial UX expansion (a heatmap or per-week strip view). All of that is one or two follow-up changes; bundling it here would triple the scope without meaningfully improving what ships in the meantime.

The UI panel structure is designed to add a "weekly view" toggle later without restructuring — the row component renders one person's totals; a weekly variant would render that same row as a strip of cells. Both can coexist.

### D2 — Planned-hours formula: `pct × defaultCapacityPct × 40h × weeks / 100²`

`weeks_in_range = (end - start) / (7 days)`, allowing fractional weeks. Example: 50% allocated over 8 weeks for a person at 100% default capacity = `0.5 × 1.0 × 40 × 8 = 160 hours`.

The `40 hours / full-time-week` is hardcoded. A configurable "team baseline" (e.g., 32h for orgs with shorter workweeks) is a future expansion; defaulting to 40 matches Harvest's own assumption and the PortX norm.

`defaultCapacityPct` lets a part-time team member (say, 50%) have their planned hours scaled accordingly without the PM needing to think about it on each allocation row.

### D3 — Actuals are total hours (billable + non-billable), not just billable

Capacity reconciliation is "did the work happen," not "did we bill for it." A person who spent 10h on internal alignment that turned out to be non-billable still spent 10h of their week. Use the same `spent_hours_billable + spent_hours_nonbillable` total the existing `Project.spentHours` derivation uses.

The HarvestPanel splits billable vs. non-billable per its existing requirement; the reconciliation panel doesn't — it sums.

### D4 — Variance buckets: green ≤10%, amber ≤25%, red >25%, neutral when no Harvest link

Thresholds are simple and bisectable:

- `|variance / planned|` ≤ 10% → green ("on plan")
- 10% < `|variance / planned|` ≤ 25% → amber ("watch")
- `|variance / planned|` > 25% → red ("attention")
- Person has no `harvest_user_id` set → neutral gray, label "no Harvest link"

Variance is signed: a person at +30% (logged more than planned) and a person at −30% (logged less) both land in red, but the panel shows the sign so the PM can tell which.

The thresholds are constants in code, not configurable. Real-world tuning may follow once the team uses it for a few weeks.

### D5 — Admin-driven Harvest-user linking, no auto-match

Same rationale as #3's name-resolution: false positives in finance-adjacent data are worse than the friction of an admin clicking a dropdown. A future change can layer auto-match-by-name with admin batch-approval on top of this; this change ships with the manual table.

### D6 — Per-person reconciliation is server-aggregated; per-project is client-computed

The per-project view is a join of two datasets the page **already has** loaded: `allocations` (from the project detail page's existing query) and the Harvest snapshot (from the HarvestPanel's query). Computing the join client-side avoids a new endpoint and a duplicate fetch.

The per-person view needs every linked project's snapshot to compute totals, which is a much larger fetch than the page would otherwise do. That goes through a new server endpoint (`GET /api/people/:id/reconciliation`) that does the aggregation in one query and returns ready-to-render rows.

### D7 — "Logged but not allocated" section is visible by default

When the Harvest breakdown includes a person who isn't allocated in Torii (e.g., a developer rotated in to help but the allocation wasn't created), they appear in a secondary section below the primary table. Hidden via a `<details>` element so they don't crowd the main view but are one click away. This is the inverse error case — invisible work — and the PMO needs to be able to see it.

### D8 — UI panel structure positions for future weekly view

The `<ReconciliationPanel>` and `<PersonReconciliationSection>` both follow the pattern: row component = `{ person, plannedHours, actualHours, variance, status }`. A future weekly variant will render that same row as a horizontal strip of week-cells; the data shape doesn't have to change to add it. Avoid embedding lifetime-specific assumptions in the row component itself.
