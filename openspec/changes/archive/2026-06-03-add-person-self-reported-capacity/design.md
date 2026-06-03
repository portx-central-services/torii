## Constraints

- ~64 people at PortX's current scale, average maybe 5 active projects per person. The `person_project_capacities` table will be in the low hundreds of rows at most. A single endpoint reading the full set for one person is cheap; no caching needed.
- `Allocation` already exists with `(personId, projectId, pct, start, end)`. The new `PersonProjectCapacity` is keyed on `(personId, projectId)` — one row per (person, project) pair, not date-ranged. They model different things; they don't collapse into one table.
- `Person.defaultCapacityPct` is the part-time baseline (100% for full-time, 80% for a 4-day week). The new `availabilityPct` is "of that baseline, how much is open." They're orthogonal — both stay.

## Decisions

### D1 — Extend `/people/:id`, don't create `/users/:id`

The user verbally asked for a "user page", but Torii already has `/people/:id` and the user has internalized that URL across the rest of the app. The data and access pattern are identical (a profile of one Person). We extend the existing page with a Workload section rather than fork the URL space.

The breadcrumb stays as "Person detail" — the page is already shaped around showing a person, so we don't need to rename. The page header itself ("name + role") already reads as a user profile.

### D2 — Self-reported capacity is per-(person, project), not per-allocation

The simpler model would have been to add `weeklyPct` to `Allocation`. We rejected this because:

- Allocations are date-ranged; the self-report is a single "right now" value. Putting it on the allocation row would either force the person to update each allocation individually as date ranges change, or it would conflate two timescales (weekly self-report on a multi-month allocation).
- Self-reports must be writable independently of the PM-owned allocation. If the person reports time on a project they don't have a formal allocation on, that's signal — we want it.
- The composite key `(personId, projectId)` makes the upsert trivial and avoids juggling multiple capacity rows for one person-project pair.

### D3 — `availabilityPct` lives on `Person`, not on a separate row

Availability is a single scalar per person, not per project. The natural home is a column on `Person`. We considered a `person_availability` table for history but defer that to a future change (see D6).

### D4 — Permissions: self + admin, enforced server-side

Self ownership is the core principle — the person reports their own week. Admin is added because real-world incidents come up: someone's out, the PM needs to update the workload context for staffing decisions, an admin can do it for them. PM role alone is too broad — every PM editing every other person's workload would invert the ownership model.

The check `viewer.id === person.id || viewer.isAdmin` is enforced at the API layer in `PATCH /api/people/:id/workload`; the UI hides edit affordances under the same rule for UX. Both halves are required — server-side because anyone can hand-craft a request, client-side because rendering disabled inputs that always 403 is bad UX.

### D5 — Advisory sum, not enforced

Real human weeks don't sum to 100%. Meetings, context-switching, on-call, support — there's always a fraction that doesn't fit a project bucket. If we hard-capped, the person would have to play whack-a-mole every time they nudged one row. The amber "over-committed by N%" line is the signal; the math is left in the user's hands.

This also protects against a Hyrum's Law trap where teams game the numbers to fit the cap rather than report honestly. The point of the self-report is the honest read.

### D6 — Today's value only; no history

We store the current `weekly_pct` and overwrite on update. No timeline table, no audit log, no "as of date" snapshot. Adding history would 5×–10× the schema complexity and isn't motivated by any current question. A weekly snapshot table is a natural follow-up if we later need "is Aaron trending toward overload."

The `updated_at` column is on the row so the UI can show "last reported N days ago" when the value is stale, but the data layer doesn't actively decay or hide it.

### D7 — `GET /api/people/:id/workload` is a separate endpoint, not bolted onto `/api/people/:id`

We could have layered the workload data onto the existing `GET /api/people/:id` response. We didn't, because:

- The existing endpoint returns a Person row with simple fields. The workload response carries joined data (project rows, allocations, hours-shaped numbers) that doesn't belong on a basic Person fetch.
- Other consumers of `GET /api/people/:id` (the people list, trackers admin UI, etc.) don't need workload data — paying for the join on every Person fetch is wasteful.
- Keeping workload as its own endpoint preserves the option to cache it independently later, or refresh it without refetching the whole Person.

### D8 — `weeklyPct = 0` means "delete the row," not "store zero"

The PATCH endpoint's semantics: setting `weeklyPct` to 0 for a project removes that project from the person's self-reported workload. Storing zero rows in the table would clutter the read endpoint and force the UI to filter them out anyway. The delete-on-zero approach keeps the row set tight and the "currently working on" definition clean — non-zero self-report rows represent active workload, full stop.

The UI's "remove from my workload" button is therefore implemented as a PATCH with `weeklyPct: 0`, not a separate DELETE endpoint. Composability and a single endpoint to test.
