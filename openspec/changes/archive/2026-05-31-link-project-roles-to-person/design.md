## Constraints

- The existing `Person` model requires a non-null, unique `email`. Monday-extracted names don't carry emails. Any migration / sync that creates a Person row from a string has to supply an email — see D2.
- Project role assignments are derived from Monday today. The Monday "Senior Consultant" column maps to the legacy storage key `solution_consultant`. Storage-key churn is expensive (touches `field_mapping` snapshots, the title-map, every project row's `details`). The FK column name reuses the legacy storage key for that reason.
- Names in `details` are not normalized — Monday could ship "Aaron Levy", "aaron levy", "Aaron J. Levy" for the same human. Fuzzy matching is dangerous in finance-adjacent data, so we use case-insensitive exact match.

## Decisions

### D1 — Keep `details` strings as immutable Monday-extracted history; FK is the canonical Torii reference

The string in `details.project_manager` is the **exact value Monday last sent us**. The FK column `project_manager_id` is **the Torii-resolved Person reference**. Both are kept indefinitely:

- The FK is the source of truth for joins and downstream queries (the next change relies on this).
- The string survives so we can re-resolve later if a Person is renamed, deduped, or otherwise edited, without losing the Monday-side value.
- Display priority: when the FK is set, render `Person.name`. When the FK is null (e.g., a project whose Monday string is empty), fall back to the string.

This dual-source pattern intentionally mirrors how `trackerRaw` retains the Monday item alongside the merged Torii fields.

### D2 — Synthetic email `@torii.unresolved` for Person rows created from Monday strings

The Person model requires `email UNIQUE NOT NULL`. We can't ship without satisfying that constraint. Options considered:

- **(a) Make `email` nullable.** Schema change; conflates two concerns (auth-able users vs. import-only contacts). Defer until we genuinely need to separate them.
- **(b) Add a `Contact` table separate from `Person`.** Cleaner domain model; ~3× the work for this change. Defer to a follow-up.
- **(c) Use a synthetic email for import-only rows.** Chosen.

The synthetic email format is `<slug>@torii.unresolved`. `.unresolved` is not a real TLD, so synthetic addresses can never collide with real DNS-resolvable email. Admins can later edit a Person to assign the real email when they sign in.

When a synthetic-email Person eventually signs in via SSO with a real email, that's a future reconciliation problem — a "merge person" UI can handle it. For now we accept the possibility of duplicate Person rows in exchange for unblocking the FK plumbing today.

### D3 — Case-insensitive exact match; no fuzzy matching

Resolution looks for an existing Person with `LOWER(name) = LOWER(monday_string)`. No edit distance, no token normalization, no nickname expansion. False positives ("Aaron L" linking to "Aaron Levy") would silently mis-attribute project assignments and downstream hours — far worse than the inconvenience of an admin manually merging duplicates.

### D4 — FK column name keeps the legacy storage-key convention

The display label for the third role is **"Senior Consultant"** per the prior change. The legacy storage key in `details` is **`solution_consultant`**. The new FK column is **`solution_consultant_id`** for storage-key consistency. Renaming the storage key would touch every project's `details` JSONB, every `field_mapping` snapshot, and the Monday title map — high cost for low value when the only thing the user actually sees is the display label.

### D5 — Add `harvest_user_id` on Person now, populate later

The bridge between a Torii Person and a Harvest user lives on `Person.harvest_user_id` (numeric Harvest user ID as TEXT, UNIQUE). This change creates the column but does NOT auto-populate it. Change #1 (Allocations ↔ Actuals reconciliation) is where the population logic lives — there's a per-person reconciliation UX there that includes selecting the Harvest user.

This lets #3 ship without depending on Harvest's user-listing endpoint, and gives #1 a clean column to write into.

### D6 — Monday post-extraction person resolution runs in the sync engine, not the adapter

The Monday `MondayAdapter` stays "extract strings from Monday columns" — it has no concept of Person rows. The person-resolution step is a **separate function** invoked by the sync engine after `mergeExternalIntoTorii` returns the patch. This keeps the adapter trivially testable in isolation and means the same resolver utility powers both the one-shot data migration and the ongoing sync.

### D7 — Resolution writes to FK columns, never modifies `details`

The post-extraction resolver only ever reads `details` and writes the corresponding `*_id` column on `projects`. It never modifies the `details` strings. This means a future sync that brings a renamed Monday name will (a) update the `details` string via the existing merge engine, then (b) re-resolve and update the FK. Both sides stay in sync without manual intervention.

### D8 — `/people/:id` view is a read-only project list grouped by role

The new person page is intentionally small in this change: header (name, email, role badge) + four sections (Owner / PM / SA / SC), each listing the projects this person is in that role. Each project row links to its detail page; the over-budget chip from #harvest-integration carries over.

Out of scope for this change (but natural follow-ups):
- The actual capacity utilization view (% of weeks at >100% allocation, etc.) — that's part of #1's reconciliation work.
- Per-person Harvest hours view — also #1.
- Person edit / merge UI — needed once we accumulate synthetic-email duplicates.
