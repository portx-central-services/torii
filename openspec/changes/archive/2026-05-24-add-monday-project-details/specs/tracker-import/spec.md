## ADDED Requirements

### Requirement: Persist last-synced tracker payload per project

The system SHALL persist the full external item payload (e.g., the Monday item with its `id`, `name`, and `column_values`) on the linked Torii Project after every successful per-item fetch. The payload MUST be stored as nullable JSON on the Project (e.g., `projects.tracker_raw`) and MUST be overwritten on each subsequent successful fetch so it always represents the most recent sync. The payload is informational only and MUST NOT be consulted by the merge logic that determines which fields the tracker owns.

#### Scenario: First import populates the snapshot
- **GIVEN** an admin imports Monday item `12345` for the first time
- **WHEN** the adapter returns the item with `column_values`
- **THEN** the new Torii Project row has `tracker_raw` set to the full Monday payload

#### Scenario: Subsequent sync overwrites the snapshot
- **GIVEN** a linked Torii Project whose `tracker_raw` reflects yesterday's Monday state
- **WHEN** sync runs today and the adapter returns the item with updated column values
- **THEN** `tracker_raw` is replaced with today's payload (no merging, no append)

#### Scenario: Snapshot is refreshed even when no field-mapped change occurred
- **GIVEN** a linked Torii Project whose `field_mapping.name` is `torii`
- **WHEN** sync runs and the Monday item name has changed but Torii owns `name`
- **THEN** the Torii project's `name` is NOT updated but `tracker_raw` IS refreshed to reflect the latest Monday payload

#### Scenario: Force-mode refresh updates the snapshot per item
- **GIVEN** a PM clicks Sync Now on the trackers page (force mode)
- **WHEN** the engine iterates each linked project and calls `adapter.getProject(externalId)` per item
- **THEN** each project's `tracker_raw` is updated with the freshly fetched payload, and items where the adapter throws a per-item error retain their previous `tracker_raw` value

#### Scenario: Adapter returns null leaves the snapshot intact
- **GIVEN** a linked Torii Project with an existing `tracker_raw`
- **WHEN** sync runs and `adapter.getProject(externalId)` returns null (item no longer accessible)
- **THEN** the Torii Project row is NOT updated and `tracker_raw` retains its previous value
