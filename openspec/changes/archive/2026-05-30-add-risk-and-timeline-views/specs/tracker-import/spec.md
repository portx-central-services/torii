## ADDED Requirements

### Requirement: Monday adapter extracts the project phase
The Monday.com adapter SHALL populate an optional `phase` field on the `ExternalProject` it returns by reading the column titled `Project Phase`. Resolution order MUST be: (1) if the cell value contains a leading `[N]` bracket prefix, take `N` as a 1-based index into the Torii `PHASES` ordering (`[1]`→`Backlog`, `[2]`→`Initiation`, … `[7]`→`Production`); (2) otherwise compare the value (stripped of any bracket prefix) against each phase's display label case-insensitively (`Go-Live Readiness` ↔ `GoLiveReadiness`); (3) if neither matches, omit `phase` from the result — the adapter MUST NOT guess.

The default `field_mapping` MUST set `phase` to `monday` so the value is applied on sync. A per-project `field_mapping.phase = 'torii'` MUST suppress the update so PMs can pin the phase locally.

#### Scenario: Bracketed phase label resolves by index
- **GIVEN** a Monday item whose "Project Phase" column value is `[4] Development`
- **WHEN** the adapter builds the `ExternalProject`
- **THEN** the result includes `phase = "Development"`

#### Scenario: Phase label without bracket resolves by display name
- **GIVEN** a Monday item whose "Project Phase" column value is `Go-Live Readiness` (no bracket prefix)
- **WHEN** the adapter builds the `ExternalProject`
- **THEN** the result includes `phase = "GoLiveReadiness"`

#### Scenario: Unrecognized phase label is omitted
- **GIVEN** a Monday item whose "Project Phase" column value is `Some Unknown Label`
- **WHEN** the adapter builds the `ExternalProject`
- **THEN** `phase` is absent on the result; sync MUST NOT overwrite the existing phase

#### Scenario: Missing "Project Phase" column is omitted
- **GIVEN** a Monday item that has no "Project Phase" column
- **WHEN** the adapter builds the `ExternalProject`
- **THEN** `phase` is absent on the result

### Requirement: Monday adapter extracts key-date columns
The Monday.com adapter SHALL populate an optional `keyDates` map on the `ExternalProject` it returns by matching a fixed, documented set of Monday board-column titles to `keyDates.*` keys: "Project Add Date"→`kickoff` (PMO intake — the kickoff event), "Project Start Date"→`project_start` (start of active delivery work, distinct from kickoff), "UAT Start Date"→`uat_start`, "Baseline Go-live"→`baseline_go_live`, "Expected Go-Live Date"→`target_go_live`, "Actual Go-Live Date"→`actual_go_live`.

For each mapped column the value MUST be a yyyy-mm-dd ISO date taken from the column's `text` when present, otherwise parsed from the column's JSON-encoded `value.date`. Columns whose titles are not in the map MUST be ignored for `keyDates`. Empty values MUST be omitted. There MUST be no mapping for `hypercare_end` — it has no Monday source and remains Torii-derived.

#### Scenario: Recognized date column maps to a keyDates key
- **GIVEN** a Monday item with a column titled "Expected Go-Live Date" whose text is "2026-09-01"
- **WHEN** the adapter builds the `ExternalProject`
- **THEN** the result includes `keyDates.target_go_live = "2026-09-01"`

#### Scenario: Every recognized date column is extracted in one pass
- **GIVEN** a Monday item with all six date columns populated
- **WHEN** the adapter builds the `ExternalProject`
- **THEN** `keyDates` contains entries for `kickoff`, `project_start`, `uat_start`, `baseline_go_live`, `target_go_live`, and `actual_go_live`

#### Scenario: Date column with empty text and a JSON value
- **GIVEN** a Monday item whose "Expected Go-Live Date" column has empty text and value `{"date":"2026-10-15"}`
- **WHEN** the adapter builds the `ExternalProject`
- **THEN** `keyDates.target_go_live` equals `"2026-10-15"`

#### Scenario: Unrecognized date column is ignored for keyDates
- **GIVEN** a Monday item with a column titled "Some Other Date"
- **WHEN** the adapter builds the `ExternalProject`
- **THEN** no `keyDates` entry is created for it (the raw payload still preserves it via `tracker_raw`)

#### Scenario: Item with no recognized date columns yields no keyDates
- **GIVEN** a Monday item with only non-date columns
- **WHEN** the adapter builds the `ExternalProject`
- **THEN** `keyDates` is absent on the result (not an empty object)

## MODIFIED Requirements

### Requirement: Field ownership
The system SHALL store a per-Project `field_mapping` declaring, for each tracked field, whether `torii` or `monday` is the owner. During sync, the system MUST update only fields whose owner is `monday`. Fields owned by `torii` MUST be preserved exactly. The default mapping MUST be: `name`, `phase` (sourced from the Monday "Project Phase" status column), and the Monday-sourced `details.*` fields (`details.project_manager`, `details.solution_architect`, `details.solution_consultant`, `details.core_solution`, `details.core_vendor`, `details.status_report_url`, `details.jira_project_url`, `details.customer_type`, `details.finance_use_case`, `details.use_case_group`, `details.customer_status`) owned by `monday`; every Monday-sourced key date (`key_dates.kickoff`, `key_dates.project_start`, `key_dates.uat_start`, `key_dates.baseline_go_live`, `key_dates.target_go_live`, `key_dates.actual_go_live`) owned by `monday`; `state`, `key_dates.hypercare_end` (no Monday source), `details.primary_contact` (no Monday source), and all allocations owned by `torii`. Per-key ownership applies — the merge engine MUST iterate `keyDates` entries and apply each independently.

#### Scenario: Sync updates Monday-owned phase
- **GIVEN** a linked project with default `field_mapping` whose current phase is `Development` and a Monday item whose "Project Phase" column resolves to `UAT`
- **WHEN** sync runs
- **THEN** the Torii project's `phase` is updated to `UAT`

#### Scenario: Per-project torii override pins phase locally
- **GIVEN** a linked project whose `field_mapping.phase` is `torii` and current phase is `UAT`
- **WHEN** sync runs and Monday.com reports a phase of `Development`
- **THEN** the Torii project's phase remains `UAT`

#### Scenario: Sync updates Monday-owned name
- **GIVEN** a linked project whose `field_mapping.name` is `monday`
- **WHEN** sync runs and the Monday.com item name has changed
- **THEN** the Torii project's name is updated to match

#### Scenario: Sync updates a Monday-owned details field
- **GIVEN** a linked project whose `field_mapping."details.banking_core"` is `monday`
- **WHEN** sync runs and the Monday board's "Banking Core" column value has changed
- **THEN** the Torii project's `details.banking_core` is updated to match

#### Scenario: Sync preserves a PM-overridden details field
- **GIVEN** a linked project whose `field_mapping."details.primary_contact"` is `torii` and a PM-set value
- **WHEN** sync runs and the Monday board reports a different primary contact
- **THEN** the Torii project's `details.primary_contact` is left unchanged

#### Scenario: Sync applies multiple Monday-owned key dates in one patch
- **GIVEN** a linked project with default `field_mapping` and a Monday item exposing `Project Add Date`, `Project Start Date`, `UAT Start Date`, `Expected Go-Live Date`, and `Actual Go-Live Date`
- **WHEN** sync runs
- **THEN** the Torii project's `key_dates` map is updated with `kickoff` (← Project Add Date), `project_start` (← Project Start Date), `uat_start`, `target_go_live`, and `actual_go_live` set from the Monday values

#### Scenario: Per-key torii override on one key date does not block the others
- **GIVEN** a linked project whose `field_mapping."key_dates.target_go_live"` is `torii` and a Monday item exposing both `Expected Go-Live Date` and `Project Add Date`
- **WHEN** sync runs
- **THEN** `target_go_live` is unchanged but `kickoff` is updated from the Monday value
