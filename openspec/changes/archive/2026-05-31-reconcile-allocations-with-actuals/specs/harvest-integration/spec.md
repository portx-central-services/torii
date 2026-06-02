## ADDED Requirements

### Requirement: Harvest user listing endpoint
The system SHALL expose `GET /api/tracker/harvest/users` (admin-only) returning every active Harvest user from the connected workspace, joined with the existing `Person.harvest_user_id` links. Each row MUST include:

- `harvestUserId` — the Harvest user's numeric ID as text
- `name`, `email` — from Harvest's `/v2/users` response
- `linkedToiriPersonId` — null when not yet linked
- `linkedToiriPersonName` — null when not yet linked

The endpoint MUST page through Harvest's `/v2/users` results (100 per page) and respect the rate limit (paged sequentially). On 429, surface as a 429 response with the standard retry-in-15s body. On no active Harvest connection, return 404.

#### Scenario: Healthy connection lists users with link state
- **GIVEN** an active Harvest connection and 3 Harvest users, one of whom is linked to a Torii Person
- **WHEN** an admin calls the endpoint
- **THEN** the response is 3 rows; the linked one carries `linkedToiriPersonId` and `linkedToiriPersonName`, the others have `null` for both

#### Scenario: Non-admin is rejected
- **GIVEN** a PM (not admin)
- **WHEN** they hit the endpoint
- **THEN** the response is 403; no Harvest call is made

#### Scenario: No connection
- **GIVEN** no Harvest connection exists
- **WHEN** an admin hits the endpoint
- **THEN** the response is 404

### Requirement: Per-Person Harvest user-link endpoints
The system SHALL expose two admin-only mutation endpoints to manage the `Person.harvest_user_id` bridge:

- `POST /api/people/:id/harvest-link` — body `{ harvestUserId: string }`. Sets the Person's `harvest_user_id`. Resolves the harvestUserId via `listUsers()` to confirm it exists in the workspace; rejects with 400 when the Harvest user is unknown OR when another Person already holds that `harvest_user_id` (uniqueness enforced by the existing index).
- `DELETE /api/people/:id/harvest-link` — clears the Person's `harvest_user_id`. Returns 204.

Both endpoints MUST reject non-admin callers with 403.

#### Scenario: Admin links a Person to a Harvest user
- **GIVEN** an admin, a Person with `harvest_user_id` null, and a valid Harvest user `12345`
- **WHEN** the admin POSTs `{ harvestUserId: "12345" }`
- **THEN** the Person's `harvest_user_id` is set to `"12345"` and the response is 200

#### Scenario: Linking a Harvest user already used elsewhere is rejected
- **GIVEN** Person A is already linked to Harvest user `12345`
- **WHEN** an admin tries to link Person B to the same `12345`
- **THEN** the response is 400; Person B's link is unchanged

#### Scenario: Linking an unknown Harvest user is rejected
- **GIVEN** no Harvest user `99999` exists in the workspace
- **WHEN** an admin tries to link a Person to `99999`
- **THEN** the response is 400; no Person row is updated

#### Scenario: Non-admin cannot link
- **GIVEN** a PM (not admin)
- **WHEN** they hit either endpoint
- **THEN** the response is 403

#### Scenario: Unlink clears the FK
- **GIVEN** an admin and a Person with `harvest_user_id` set
- **WHEN** they DELETE the link endpoint
- **THEN** the Person's `harvest_user_id` is null and the response is 204

### Requirement: /trackers Harvest user-link table
The `/trackers` page SHALL render a `<HarvestUserLinkTable>` below the existing `<HarvestLinkTable>` whenever a healthy Harvest connection exists. The table MUST:

- Show one row per Harvest user from `GET /api/tracker/harvest/users`.
- Display the Harvest user's name + email + the current link state (linked Torii Person name, or empty).
- Render a `<select>` per unlinked row offering the full list of Torii People (from `GET /api/people`), filtered to those who aren't already linked to a different Harvest user. Selecting one calls the link endpoint.
- For already-linked rows, render the linked Person's name as plain text with a small "Unlink" affordance that calls the DELETE endpoint.

After any link / unlink, the table re-fetches both queries (Harvest users + Torii People) so the dropdown options update.

#### Scenario: Admin sees the table on /trackers
- **GIVEN** an admin and a healthy Harvest connection
- **WHEN** they open `/trackers`
- **THEN** the Harvest user-link table is rendered below the project-link table

#### Scenario: Bulk link submits per-row
- **GIVEN** the admin has selected Torii Person A for Harvest user 1 and "Skip" for Harvest user 2
- **WHEN** they save
- **THEN** one `POST /api/people/:id/harvest-link` call is made for Harvest user 1; no call for Harvest user 2

#### Scenario: Unlink affordance clears the link
- **GIVEN** a row that is already linked
- **WHEN** the admin clicks "Unlink"
- **THEN** the corresponding `DELETE /api/people/:id/harvest-link` is called and the row re-renders as "available for linking"
