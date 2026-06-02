## Decisions

### D1 — Display rename only; the `solution_consultant` storage key stays

The detail key is `solution_consultant` in every project's `details` JSONB AND in every stored `field_mapping` snapshot. Renaming the key would require (a) a data migration touching every project row, (b) updating Monday's title-map, (c) updating every snapshot of `DEFAULT_FIELD_MAPPING` stored on existing projects. The user-visible benefit is the same either way — labels and dropdowns read "Senior Consultant" — so display-only rename is the right trade.

The Monday adapter's title-map keeps `"Senior Consultant" → solution_consultant`. That mapping is already in place from `add-monday-project-details`; nothing about Monday extraction changes here.

### D2 — Single-select tile filters; clicking the active tile clears

Multi-select tiles plus the existing dropdown filters would produce confusing combined state ("Active AND Blocked"). One click selects, one click clears, and the existing dropdowns still handle multi-select for state and phase when that's actually wanted. The active tile is visually distinguished (border accent).

### D3 — "Go-Live ≤ 60d" excludes Done projects

A Done project whose `target_go_live` is in the past 60 days isn't an upcoming launch — it's a launched project. Filtering to non-Done keeps the tile actionable as "what's about to ship and might still need attention."

### D4 — Projects search composes with the tile filter and existing dropdowns via AND

If a user types "Acme" AND clicks "At Risk", they want at-risk projects whose name/details contain "Acme" — not the union. AND composition mirrors the user's mental model. The filter pipeline runs in order: tile filter → dropdown filters → search.

### D5 — Sticky bands use `position: sticky`, not `position: fixed`

Sticky preserves document flow so content scrolls naturally underneath the bands without needing body padding. Fixed would overlap rows on first paint or require precise spacer math. `position: sticky; top: 0` on the header and `position: sticky; bottom: 0` on the user footer with the right `z-index` ordering gets the desired behavior cleanly.

### D6 — Projects search filters client-side

The list is already fully fetched on page render (no pagination today). Client-side filter is instant and avoids a server round-trip. If the list ever grows past a few thousand rows we can revisit; at ~200 it's a non-issue.

### D7 — Previous-week subtext displays even when last week was Green

The arrow already encodes direction (▲/▼/=). Adding the explicit "Last week: Green / Inform" subtext gives a PM the prior state in plain text — useful when a project transitioned Green → Red this week (the arrow alone says "worse," the subtext says "from Green specifically"). When there's no prior week, render "Last week: no update" so the line slot is consistent across cards.

### D8 — Harvest sort is client-side, not server-side

`GET /api/tracker/harvest/projects` already returns the full list. Sorting in `<HarvestLinkTable>` via `.sort((a, b) => a.name.localeCompare(b.name))` is one line and avoids touching the adapter, the route, or the existing endpoint contract. Server-side sort would change the API surface for no functional gain.
