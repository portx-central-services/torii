## ADDED Requirements

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
