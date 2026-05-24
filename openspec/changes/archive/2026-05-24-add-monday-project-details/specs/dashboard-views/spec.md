## ADDED Requirements

### Requirement: Project detail page surfaces the tracker payload

The project detail view SHALL render a "Monday details" panel for any project linked to a Monday tracker. The panel MUST display the Monday item identifier and row title for traceability, MUST tabulate every populated column from the last-synced payload showing the column title (with id fallback), the text value, and the column type, and MUST provide a toggle to reveal or hide the raw JSON payload for debugging. Projects without a tracker link MUST NOT render the panel.

#### Scenario: Panel hidden for projects without a tracker link
- **GIVEN** a Torii project with `tracker_ref` set to null
- **WHEN** a user opens the project detail page
- **THEN** the Monday details panel is not rendered

#### Scenario: Panel renders identity for linked project
- **GIVEN** a Torii project linked to a Monday item with a fetched payload
- **WHEN** a user opens the project detail page
- **THEN** the panel displays the Monday item id and row title from the stored payload

#### Scenario: Panel tabulates populated columns
- **GIVEN** a Monday payload whose `column_values` include a `Status` column with text "On track" and an empty `Owner` column
- **WHEN** the panel renders
- **THEN** the Status row appears in the table (title "Status", value "On track", type as reported by Monday) and the empty Owner column is omitted

#### Scenario: Empty-columns state
- **GIVEN** a Monday payload whose `column_values` are all empty or absent
- **WHEN** the panel renders
- **THEN** the panel shows an empty-state message instead of a column table

#### Scenario: Raw JSON toggle
- **GIVEN** the Monday details panel is rendered with a payload
- **WHEN** the user clicks "Show raw JSON"
- **THEN** the full payload is rendered as formatted JSON below the column table; clicking again hides it

#### Scenario: No snapshot yet
- **GIVEN** a linked Torii project whose `tracker_raw` is null because no sync has succeeded yet
- **WHEN** a user opens the project detail page
- **THEN** the panel shows a message indicating no snapshot is available and prompts the user to sync from the tracker

### Requirement: Project list response excludes tracker payload

The `GET /api/projects` list response MUST NOT include the `tracker_raw` snapshot for any project. The snapshot MUST be returned only by `GET /api/projects/:id`.

#### Scenario: List endpoint omits snapshot
- **WHEN** a client calls `GET /api/projects`
- **THEN** no element in the response has a `trackerRaw` field

#### Scenario: Detail endpoint includes snapshot
- **GIVEN** a linked Torii project with a populated `tracker_raw`
- **WHEN** a client calls `GET /api/projects/:id`
- **THEN** the response includes `trackerRaw` set to the stored payload, or `null` if the project has no snapshot yet
