## ADDED Requirements

### Requirement: Derived projectType on project read responses
The project read shape returned by `GET /api/projects` and `GET /api/projects/:id` SHALL include a derived field `projectType` whose value is `'fintech'` when `details.fintech_parent` is a non-empty (after trimming) string, and `'direct'` otherwise. The field MUST NOT be persisted as a column — it is computed in `serializeProject` and only present on read responses. The field MUST NOT be accepted as input on `POST` or `PATCH` (any client-supplied `projectType` MUST be ignored or rejected).

#### Scenario: fintech_parent set yields fintech
- **GIVEN** a project with `details.fintech_parent = "Acme Holdings"`
- **WHEN** a client reads the project
- **THEN** the response includes `projectType: "fintech"`

#### Scenario: fintech_parent absent yields direct
- **GIVEN** a project with no `fintech_parent` in its `details` (or an empty string)
- **WHEN** a client reads the project
- **THEN** the response includes `projectType: "direct"`

#### Scenario: Whitespace fintech_parent is treated as absent
- **GIVEN** a project with `details.fintech_parent = "   "`
- **WHEN** a client reads the project
- **THEN** the response includes `projectType: "direct"`

#### Scenario: projectType is read-only on the API
- **WHEN** a client submits `POST /api/projects` or `PATCH /api/projects/:id` with `projectType` in the body
- **THEN** the API ignores the field (returns success with the derived value) or rejects with `400`; the project's `details.fintech_parent` is the only writable source of the derivation

### Requirement: Extended key dates for tracker-driven scheduling
The `KeyDatesSchema` (a JSON-encoded map on `Project.keyDates`) SHALL accept three additional optional yyyy-mm-dd ISO date keys beyond the existing `kickoff`, `target_go_live`, `actual_go_live`, and `hypercare_end`:

- `project_start` — start of active delivery work, distinct from `kickoff`/PMO intake (sourced from the Monday "Project Start Date" column). MUST be on or after `kickoff` when both are set.
- `uat_start` — start of the UAT phase (sourced from the Monday "UAT Start Date" column).
- `baseline_go_live` — original committed go-live (sourced from the Monday "Baseline Go-live" column); informational only — Gantt bars MUST continue to use `target_go_live` as the canonical target. `actual_go_live` is compared against `baseline_go_live` to measure delivery against the original estimate.

The `kickoff` key's semantics are clarified: it represents PMO intake / formal kickoff (sourced from the Monday "Project Add Date" column). All seven keys are optional; absence MUST be tolerated. No new database column is added; `key_dates` remains a single JSON column. Existing date-ordering invariants (e.g., `target_go_live` ≥ `kickoff`, `actual_go_live` ≥ `kickoff`) are unchanged.

#### Scenario: All seven keys accepted on read
- **GIVEN** a project whose JSON `key_dates` includes `kickoff`, `project_start`, `uat_start`, `baseline_go_live`, `target_go_live`, `actual_go_live`, and `hypercare_end`
- **WHEN** a client reads the project
- **THEN** the response's `keyDates` includes every set key with its ISO value

#### Scenario: project_start must not precede kickoff
- **GIVEN** a write to `keyDates` where `kickoff = 2026-02-10` and `project_start = 2026-02-05`
- **WHEN** the schema validates the payload
- **THEN** validation fails with a `project_start must not precede kickoff` error on the `project_start` path

#### Scenario: New keys are optional
- **GIVEN** a project whose `key_dates` JSON has only `target_go_live`
- **WHEN** a client reads the project
- **THEN** the response's `keyDates` carries `target_go_live` and no other date keys (the new keys are absent, not null)

### Requirement: Phase enum reflects the PortX PMO seven-phase set
The `Phase` enum SHALL be the ordered set `Backlog`, `Initiation`, `Design`, `Development`, `UAT`, `GoLiveReadiness`, `Production`. Enum values are TypeScript- and Postgres-safe identifiers. A `phaseLabel(phase)` helper SHALL return the human-readable display string; the only non-identity mapping is `GoLiveReadiness` → "Go-Live Readiness".

- New projects created via `POST /api/projects` without an explicit `phase` MUST default to `Backlog`.
- The auto-Done rule on `PATCH /api/projects/:id` MUST fire when the patch advances `phase` to `Production` and `actual_go_live` is set (replacing the prior trigger on `Hypercare`).
- A migration MUST remap existing rows: `Discovery` → `Initiation`, `Build` → `Development`, `UAT` → `UAT`, `Launch` → `GoLiveReadiness`, `Hypercare` → `Production`. The remap also applies to `phase_audit_log.from_phase` / `to_phase`.

#### Scenario: New project defaults to Backlog
- **GIVEN** a PM submits `POST /api/projects` with `{ name: "Acme" }` and no `phase`
- **WHEN** the API creates the row
- **THEN** the created project's `phase` is `Backlog`

#### Scenario: Auto-Done fires on advance to Production with actual_go_live set
- **GIVEN** a project whose current phase is `GoLiveReadiness` and `actual_go_live` is set
- **WHEN** a PM patches the project with `{ phase: "Production" }` and no explicit `state`
- **THEN** the project's `state` is set to `Done`

#### Scenario: Auto-Done does NOT fire on advance to GoLiveReadiness
- **GIVEN** a project whose current phase is `UAT` and `actual_go_live` is unset
- **WHEN** a PM patches the project with `{ phase: "GoLiveReadiness" }`
- **THEN** the project's `state` is unchanged

#### Scenario: Migration remaps legacy phase values
- **GIVEN** a project whose `phase` was `Launch` before the migration
- **WHEN** the `20260530100000_remap_phase_enum_7_phases` migration runs
- **THEN** the project's `phase` is `GoLiveReadiness`

#### Scenario: phaseLabel maps GoLiveReadiness to "Go-Live Readiness"
- **GIVEN** a phase value `GoLiveReadiness`
- **WHEN** the UI renders a phase dropdown/badge via `phaseLabel`
- **THEN** the displayed text is `Go-Live Readiness`; all other phase enum values display as their identifier verbatim
