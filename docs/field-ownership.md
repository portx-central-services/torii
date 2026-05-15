# How field ownership works

Torii links a project to an external tracker (Monday.com today; Jira and Linear later) by storing `tracker_ref = { provider, externalId }` on the project. From that point forward, Torii and the tracker can both have opinions about a project's fields. **Field ownership** is the rule that decides who wins.

## The model

Each project carries a `field_mapping` JSONB column. Its keys are field names (possibly dotted, like `key_dates.target_go_live`); each value is the owner — `"torii"` or `"monday"`.

During a sync, for every field that the adapter knows about:

1. Look up the owner in `field_mapping`. If not set, fall back to the **default mapping**.
2. If the owner is the tracker (e.g. `"monday"`), apply the external value when it differs.
3. If the owner is `"torii"`, leave the field alone.

External values of `undefined` (the adapter has no signal) are never applied, regardless of ownership.

## Default mapping

When `field_mapping` is empty for a field, these defaults apply:

| Field | Default owner |
| --- | --- |
| `name` | `monday` |
| `key_dates.target_go_live` | `monday` |
| `phase` | `torii` |
| `state` | `torii` |
| _everything else_ | `torii` |

The intent is "Monday owns identifying details that come from the board (name, target dates); Torii owns operational state that PMs maintain (phase, state, allocations)."

## Example: PM edits phase while sync is running

1. PM patches `phase: "UAT"` via `PATCH /api/projects/:id`. The endpoint persists the change and writes a `phase_audit_log` row. Phase is owned by Torii.
2. The 30-minute cron tick fires. The Monday adapter returns the latest item.
3. The sync engine calls `mergeExternalIntoTorii(existing, external, field_mapping)`.
4. For `phase`, the owner is `torii` (default). The patch does **not** include `phase`. The PM's edit is preserved.
5. If the Monday item's `name` changed in the meantime, the patch does include `name` (default owner is `monday`), and the project name is updated.

## How to override the defaults

Set `field_mapping` on the project. For example, to keep a project's name editable inside Torii even though it is linked to Monday.com:

```sql
UPDATE projects
SET    field_mapping = jsonb_set(field_mapping, '{name}', '"torii"')
WHERE  id = '<project-id>';
```

A UI for editing `field_mapping` per project will land in a follow-on change.

## Where this lives in the code

- Interface, defaults, types: [packages/shared/src/tracker-adapter.ts](../packages/shared/src/tracker-adapter.ts)
- Merge function (the rule): [apps/api/src/sync/merge-fields.ts](../apps/api/src/sync/merge-fields.ts)
- Sync engine (calls the merge function): [apps/api/src/sync/engine.ts](../apps/api/src/sync/engine.ts)
- Spec scenarios: [openspec/changes/add-integration-dashboard/specs/tracker-import/spec.md](../openspec/changes/add-integration-dashboard/specs/tracker-import/spec.md) — see "Field ownership"

## Why this design

A naive `tracker-always-wins` sync would overwrite PMs' edits between ticks. A naive `torii-always-wins` model would mean tracker-side updates (e.g. when an engineering manager updates the Monday board name) silently never reach the dashboard. Per-field ownership splits the difference at row-level granularity, with sensible defaults that match how PMs actually work, and lets teams opt-in to overrides where their boards differ.
