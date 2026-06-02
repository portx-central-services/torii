# risk-tracking Specification

## Purpose
TBD - created by syncing change add-risk-and-timeline-views. Update Purpose after archive.
## Requirements
### Requirement: ProjectRiskUpdate entity
The system SHALL persist a `ProjectRiskUpdate` entity with the fields: `id`, `projectId` (FK Project, cascade-delete), `weekOf` (a `DATE` anchored to the Monday of an ISO week, UTC), `ragLevel` (`Red` | `Amber` | `Green`), `riskTypes` (a non-empty subset of `Technical`, `Relationship`, `Schedule`, `ExternalDependency`, `Gap`, `Resourcing`), `state` (`Blocked` | `Inform`), `description`, `goToGreenPlan`, `latestUpdate`, `nextSteps`, `actionRequested` (all free-text, default empty string), `authorId` (FK Person, the writer of the most recent save), `createdAt`, `updatedAt`. The pair `(projectId, weekOf)` MUST be unique — there is at most one update per project per ISO week.

#### Scenario: A unique row per project per week
- **GIVEN** a project with no risk update for the current ISO week
- **WHEN** a PM creates a risk update for that project for the current week
- **THEN** a new `ProjectRiskUpdate` row is created with `weekOf` equal to the Monday of the current ISO week (UTC)

#### Scenario: Re-saving in the same week updates the same row
- **GIVEN** an existing `ProjectRiskUpdate` for `(project, current week)`
- **WHEN** a PM submits another update for the same project in the same ISO week
- **THEN** the existing row is updated (no new row), `updatedAt` advances, and `authorId` reflects the latest writer

#### Scenario: Reject empty risk types
- **WHEN** a write request omits `riskTypes` or provides an empty array
- **THEN** the API returns `400` and does NOT create or update any row

### Requirement: Read-only history endpoint
The system SHALL expose `GET /api/projects/:id/risk-updates` returning every `ProjectRiskUpdate` row for the project, newest first by `weekOf`. The endpoint MUST require an authenticated session. The endpoint is read-only — it MUST NOT mutate any data.

#### Scenario: Authenticated user reads full history
- **GIVEN** a project with three historical risk updates
- **WHEN** an authenticated user calls `GET /api/projects/:id/risk-updates`
- **THEN** the response includes all three updates ordered from newest `weekOf` to oldest

#### Scenario: Unauthenticated request is rejected
- **WHEN** the endpoint is called without a valid session
- **THEN** the API returns `401`

### Requirement: Current-week upsert endpoint
The system SHALL expose `POST /api/projects/:id/risk-updates` that upserts the `ProjectRiskUpdate` row for the project and the **current** ISO week. The endpoint MUST require the `PM` role and MUST reject (`400`) any attempt to write a `weekOf` value other than the Monday of the current ISO week. The response MUST contain the full upserted row.

#### Scenario: PM upserts this week's update
- **GIVEN** an authenticated PM
- **WHEN** they submit a valid body to `POST /api/projects/:id/risk-updates`
- **THEN** the API upserts the row for the current ISO week and returns the row, with `authorId` set to the PM's `Person.id`

#### Scenario: Non-PM is rejected
- **WHEN** an authenticated Viewer attempts the upsert
- **THEN** the API returns `403` and does NOT mutate any row

#### Scenario: Writing past or future weeks is rejected
- **WHEN** a request includes a `weekOf` that is not the Monday of the current ISO week (UTC)
- **THEN** the API returns `400` and does NOT mutate any row

### Requirement: At-risk listing endpoint
The system SHALL expose `GET /api/risks` returning every project whose most recent `ProjectRiskUpdate` (by `weekOf` descending) has `ragLevel != Green`. The response MUST include, for each such project, the project's id, name, the most recent update's `weekOf`, `ragLevel`, `riskTypes`, `state`, and a single-line title derived from the update's `description` (truncated). Projects whose most recent state is `Done` (in `Project.state`) MUST be excluded. Projects with no risk updates MUST be excluded.

#### Scenario: Currently-at-risk project appears
- **GIVEN** a project whose most recent risk update has `ragLevel = Amber`
- **WHEN** `GET /api/risks` is called
- **THEN** the project appears in the response

#### Scenario: Most-recent-Green project is excluded
- **GIVEN** a project whose most recent risk update has `ragLevel = Green` (regardless of older Reds)
- **WHEN** `GET /api/risks` is called
- **THEN** the project does NOT appear in the response

#### Scenario: Done project is excluded
- **GIVEN** a project in `state = Done` whose latest risk update is `Red`
- **WHEN** `GET /api/risks` is called
- **THEN** the project does NOT appear in the response

### Requirement: ISO week anchoring
All `weekOf` values stored or compared by the system MUST equal the Monday (00:00 UTC) of an ISO week. The API MUST normalize any client-supplied `weekOf` to this anchor before persistence and comparison, or reject mismatches outright. The system MUST NOT mix locale-specific week starts.

#### Scenario: Mid-week timestamp normalizes to Monday
- **GIVEN** the current ISO week is the week containing 2026-06-03 (Wednesday)
- **WHEN** the API computes "current ISO week's Monday"
- **THEN** the resulting `weekOf` value equals `2026-06-01`

### Requirement: Risks page (web)
The web app SHALL provide a `/risks` route accessible to any authenticated user that renders every currently-at-risk project (from `GET /api/risks`) as a card. Each card MUST display the project name (linking to its detail page), the **current ISO week's** RAG (with a colored chip), risk-type tags, state badge, and full free-text fields (`description`, `goToGreenPlan`, `latestUpdate`, `nextSteps`, `actionRequested`). The current-week card MUST show a **RAG arrow** comparing the current `ragLevel` to the most recent **prior** week's `ragLevel` (or no arrow if there is no prior update). Below the current-week card, the page MUST render a collapsible "Previous weeks" disclosure listing every prior `ProjectRiskUpdate` (newest first), each expandable to the same field set. For PM users, the current-week card MUST include an "Edit this week" action that opens an inline form to upsert that week's update via `POST /api/projects/:id/risk-updates`.

#### Scenario: Viewer sees the risks page read-only
- **GIVEN** an authenticated Viewer
- **WHEN** they open `/risks`
- **THEN** they see the list of currently-at-risk projects and the previous-weeks disclosure, with NO edit affordance

#### Scenario: PM edits the current week
- **GIVEN** an authenticated PM on `/risks` viewing a project's card
- **WHEN** they click "Edit this week", change the RAG level to `Amber`, and save
- **THEN** the API receives a `POST /api/projects/:id/risk-updates` for the current ISO week, the row is upserted, and the card re-renders with the new values

#### Scenario: RAG arrow renders week-over-week delta
- **GIVEN** a project whose previous week's RAG was `Red` and current week is `Amber`
- **WHEN** the Risks page renders the project's current-week card
- **THEN** the card includes a visual arrow indicating the level improved from `Red` to `Amber`

#### Scenario: Empty state
- **GIVEN** no projects are currently at-risk
- **WHEN** an authenticated user opens `/risks`
- **THEN** the page renders an explicit "All clear" empty state

### Requirement: Risk update entry from the project detail page
The project detail page SHALL render the `<RiskProjectCard>` component for the current project with `linkToProject={false}` and a heading "Weekly risk update". The card MUST be visible to every authenticated user, with edit affordances gated to PMs as elsewhere.

When the project has no `ProjectRiskUpdate` rows yet, PMs MUST see an "Add the first" affordance that opens the same edit form used on the Risks page. The render-branch order MUST check the editing state before the empty-history state so the form actually opens when there's no prior history.

#### Scenario: PM opens a project with no risk history
- **GIVEN** a PM viewing a project that has zero `ProjectRiskUpdate` rows
- **WHEN** the project detail page renders
- **THEN** a "Weekly risk update" card is visible with the text "No risk updates yet for this project. Add the first."

#### Scenario: PM clicks "Add the first"
- **GIVEN** the same PM on the same project
- **WHEN** they click "Add the first"
- **THEN** the inline `<RiskEditForm>` opens with default values (RAG=Amber, types=[Technical], state=Inform, empty text fields), and the empty-state text is no longer visible

#### Scenario: Viewer sees the card without edit affordances
- **GIVEN** a Viewer on the same project
- **WHEN** the project detail page renders
- **THEN** the card is visible; the "Add the first" affordance and the "Edit this week" button are NOT rendered

### Requirement: Previous-week subtext on the Risks page
Each per-project risk card on the `/risks` page SHALL display a one-line subtext under the current-week summary describing the previous week's RAG and state: "Last week: `<RAG>` / `<state>`" when an immediately-prior `ProjectRiskUpdate` exists; "Last week: no update" when no prior week is recorded. This subtext complements the existing ▲/▼/= arrow next to the current RAG chip — the arrow encodes direction; the subtext makes the prior values explicit.

The subtext is rendered in a muted style (secondary text color, slightly smaller font) so it reads as context rather than as a primary value.

#### Scenario: Card with a recorded previous week
- **GIVEN** a project that had `ragLevel=Green / state=Inform` last ISO week and `ragLevel=Red / state=Blocked` this ISO week
- **WHEN** the user opens `/risks`
- **THEN** the card's subtext reads "Last week: Green / Inform"

#### Scenario: Card with no prior week
- **GIVEN** a project whose only `ProjectRiskUpdate` row is this week's
- **WHEN** the user opens `/risks`
- **THEN** the card's subtext reads "Last week: no update"

#### Scenario: Subtext is read-only for every role
- **GIVEN** any role (PM or Viewer)
- **WHEN** the Risks page renders
- **THEN** the subtext renders identically; there is no interactive control bound to it
