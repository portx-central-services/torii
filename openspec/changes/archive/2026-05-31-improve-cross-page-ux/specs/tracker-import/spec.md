## ADDED Requirements

### Requirement: Harvest link table sorted alphabetically
The "Link Harvest projects" table on `/trackers` SHALL render rows alphabetically by Harvest project name (case-insensitive `localeCompare`). This is a UI-only sort applied in the `<HarvestLinkTable>` component over the array returned by `GET /api/tracker/harvest/projects`; the API response order itself is unchanged.

#### Scenario: Rows render alphabetically
- **GIVEN** a Harvest workspace whose API returns projects in the order ["Zeta", "Alpha", "Mu"]
- **WHEN** the user opens `/trackers` with a healthy Harvest connection
- **THEN** the link-table rows render in the order Alpha, Mu, Zeta

#### Scenario: Sort is case-insensitive
- **GIVEN** projects named "abrigo", "Acme", "BANKWELL"
- **WHEN** the link table renders
- **THEN** the rows render in case-insensitive alphabetical order (abrigo, Acme, BANKWELL)

#### Scenario: Linked and unlinked rows sort together
- **GIVEN** a mix of linked and not-yet-linked Harvest projects
- **WHEN** the link table renders
- **THEN** rows are sorted purely by name; the "Linked to X" vs "Skip / dropdown" column does not affect sort order
