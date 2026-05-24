## Context

The Torii sync engine already fetches the full column_values for each Monday item via the GraphQL adapter ([apps/api/src/sync/monday/MondayAdapter.ts](apps/api/src/sync/monday/MondayAdapter.ts)). The adapter wraps each item into an `ExternalProject` whose `raw` field carries the full Monday payload — but that payload is dropped in memory after the merge runs in [apps/api/src/sync/merge-fields.ts](apps/api/src/sync/merge-fields.ts), which only writes `name` and `keyDates.target_go_live` back to Postgres.

PMs viewing a Torii project have no signal about Monday-side state (status column, owner, custom fields), and engineers debugging a name/date mismatch must hit the Monday UI to see what the source of truth looks like. The change persists `external.raw` per project and renders it on the project detail page.

The `Project` model is the natural home for this snapshot: tracker_ref already lives there, and the row already participates in every sync write. There is exactly one snapshot per project (overwritten on each sync) — no time series.

## Goals / Non-Goals

**Goals:**
- Retain every column value from the last successful Monday sync per linked project.
- Surface the snapshot on the project detail page with a structured table plus a raw-JSON escape hatch.
- Refresh the snapshot on every sync code path that fetches an item (bulk, force, per-project, initial import, overwrite import).
- Keep payloads off the list endpoint to avoid response bloat.

**Non-Goals:**
- Historical snapshots / time-series of Monday state.
- Reverse write-back to Monday.
- Auto-discovery of per-column field ownership (e.g., infer phase from a Monday status column).
- Surfacing the snapshot in capacity rollups or any other view beyond the project detail page.
- Cross-provider abstraction beyond storing the raw JSON. The UI rendering is Monday-shaped; supporting other providers' shapes is a follow-up.

## Decisions

### Storage: nullable JSONB column on `projects`

Add `tracker_raw JSONB` to the `projects` table (mapped as `trackerRaw` in Prisma).

Rationale:
- Snapshots are 1:1 with projects and overwritten on each sync. A separate table would force a join with no semantic gain.
- Nullable lets us deploy the column ahead of any sync; projects without a tracker link stay `null`.
- Postgres JSONB allows ad-hoc projection in future migrations (e.g., extracting a specific column into a typed field) without a schema rev.

**Alternatives considered:** a separate `tracker_snapshots` table (rejected — adds a join, no need for history); column-per-Monday-field (rejected — Monday columns are tenant-defined and unbounded).

### Snapshot refresh policy: always-write on successful fetch

Every code path that successfully fetches an external item writes `trackerRaw` in the same `db.project.update` call as the merge result, regardless of whether name/keyDates actually changed.

Rationale:
- Keeps the snapshot as fresh as the most recent sync attempt, so the UI is never lying about "what Monday said last time we asked."
- Co-locates the write with the merge so we don't double up on UPDATE statements.
- Cost is negligible: linked projects are bounded and writes are cheap.

**Trade-off:** the `projectsPatched` counter in `SyncResult` now means "rows where name/keyDates changed", not "rows touched." We adjust the test in `sync-engine.test.ts` to assert this semantic.

### API surface: detail-only, additive

`GET /api/projects/:id` gains `trackerRaw: MondayItemSnapshot | null` (additive, non-breaking). `GET /api/projects` is unchanged.

Rationale:
- List responses are bandwidth-sensitive; snapshots can be a few KB per row.
- Detail responses are already heavyweight (include allocations + lastSyncedAt); one more JSON field is in the noise.

### UI: structured table + JSON escape hatch

The `MondayDetailsPanel` shows two layers:
1. Top: identity (Monday item id, row title) — always visible, helps verify the link is correct.
2. Body: table of populated columns (title, text, type) for the common case.
3. Toggle: Show/Hide raw JSON for debugging when the table view isn't enough.

Rationale:
- Most PMs want column-by-column data; the table answers that.
- Engineers debugging a parse issue need the raw shape; the toggle keeps it out of the way for the common case.

### Sequence: per-item sync write path

```
adapter.getProject(externalId)
        │
        ▼
ExternalProject { raw }
        │
        ▼
mergeExternalIntoTorii(existing, external, fieldMapping) ── patch (name?, keyDates?)
        │
        ▼
db.project.update({ trackerRaw, ...patch })
        │
        ▼
projectsPatched += (patch had real changes ? 1 : 0)
```

## Risks / Trade-offs

- **Row size growth** → JSONB compression in Postgres + per-project bounded growth. A pathological Monday item with hundreds of long text columns could still exceed the typical row size. Mitigation: monitor `pg_total_relation_size('projects')` after deploy; if needed, move snapshots to a side table later.
- **Snapshot drift from actual rendered fields** → The merged fields (name, target_go_live) and the snapshot can disagree if `field_mapping` makes one Torii-owned. This is *by design* but could confuse users. Mitigation: the UI labels the snapshot section as "Monday details" to signal it's the source-of-truth view, separate from Torii's effective values.
- **No history** → A regression on the Monday side overwrites the snapshot on the next sync, losing evidence. Mitigation: out of scope for this change; if needed, add a `tracker_snapshots` history table in a follow-up.
- **Provider coupling in the UI** → The `MondayDetailsPanel` knows the Monday shape. If Jira/Linear adapters land, they'll need their own panel or a provider-aware switch. Mitigation: accepted; named "Monday details" not "Tracker details" to make the scoping obvious.
- **Migration safety** → Adding a nullable JSONB column is safe online in Postgres (no rewrite, no default). Existing rows stay `null`; first sync populates them.

## Migration plan

1. Apply `20260523000000_add_project_tracker_raw` (one statement: `ALTER TABLE projects ADD COLUMN tracker_raw JSONB;`).
2. Deploy API + web in lockstep — the API response gains a new field, the web client consumes it. The field is optional in the type so older clients won't break.
3. No backfill needed. Snapshots populate naturally on the next per-project sync; users can also click Sync Now to force-populate immediately.
4. Rollback: drop the column (`ALTER TABLE projects DROP COLUMN tracker_raw;`) and redeploy prior API/web. No data loss in core tables.

## Open Questions

- Should we eventually surface a "freshness" indicator on the panel (e.g., last-synced-at relative time)? The connection-level `lastSyncedAt` is already shown elsewhere; per-snapshot timestamping would require a separate column (`tracker_raw_synced_at`) or storing it inside the JSON. Deferred until users ask.
- Should we sanitize/redact any Monday columns (e.g., emails, person fields) before storing? Today everything Monday returns gets stored verbatim. If Torii ever stores customer data, revisit.
