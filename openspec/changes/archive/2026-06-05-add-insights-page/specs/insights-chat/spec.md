## ADDED Requirements

### Requirement: `GET /api/insights/overview`
The system SHALL expose `GET /api/insights/overview` returning the aggregated payload the Insights page renders. Accessible ONLY to users with role `PM` or `isAdmin === true`; returns 403 otherwise.

Response shape:

```ts
{
  asOf: ISO timestamp,                              // server clock when the response was assembled
  kpis: {
    activeProjects: number,
    atRisk: number,
    recoveredThisWeek: number,                       // current-week RAG = Green AND previous-week ≠ Green
    overBudget: number,
    launchingSoon: number,                           // target_go_live within 30 days, state ≠ Done
    hours7d: number,                                 // org-wide Harvest hours, trailing 7 days
    hours30d: number,                                // trailing 30 days
    activeCustomers: number,                         // customers with ≥1 non-Done project
  },
  projects: Array<{
    projectId, projectName, customerId, customerName,
    phase, state,
    latestRagLevel: RagLevel | null,
    weeksStuckAtLevel: number,                       // ≥1 only when latest RAG is non-Green
    daysInCurrentPhase: number | null,               // from PhaseAuditLog; null when never transitioned
    budgetHours: number | null,                      // sum across pinned harvest_projects
    spentHours: number | null,
    pctOfBudget: number | null,                      // spent / budget × 100; null when budget is null or 0
    slipDays: number | null,                         // target_go_live − baseline_go_live, null when either missing
    last30DaysHours: number,                         // sum across pinned Harvest projects, all logged hours by anyone
  }>,
  people: Array<{
    personId, name, email, role, isAdmin,
    harvestUserId: string | null,
    defaultCapacityPct: number,
    availabilityPct: number,
    committedPct: number,                            // Σ self-reported weekly capacity
    last7DaysHours: number | null,                   // null when not Harvest-linked
    last30DaysHours: number | null,
    activeProjectCount: number,                      // same union the Workload section uses
    overCommittedBy: number,                         // max(0, committed + availability − default)
  }>,
  trends: {
    weeklyHours: Array<{ weekOf: ISO-date, hours: number }>,           // 8 entries, oldest first
    weeklyRag:   Array<{ weekOf: ISO-date, red: number, amber: number, green: number }>,
  },
}
```

The endpoint MUST be a single round trip; consumers (the page + Claude tool calls) should not need to fan out to other endpoints to assemble the same view.

#### Scenario: 403 for non-PM, non-admin
- **WHEN** an authenticated Viewer reads the endpoint
- **THEN** the response is 403

#### Scenario: Recovered count math
- **GIVEN** 3 projects with current-week RAG = Green; of those, 1 had previous-week RAG = Red, 1 had previous-week RAG = Amber, 1 had previous-week RAG = Green
- **WHEN** a PM reads the endpoint
- **THEN** `kpis.recoveredThisWeek` equals 2 (the Red→Green and Amber→Green projects)

#### Scenario: Trend windows are exactly 8 ISO weeks
- **WHEN** a PM reads the endpoint
- **THEN** both `trends.weeklyHours` and `trends.weeklyRag` contain exactly 8 entries, oldest first, with the most recent entry at index 7

#### Scenario: Per-user rows include all Harvest-linked Persons
- **GIVEN** 20 Persons total, 12 of whom have a non-null `harvestUserId`
- **WHEN** a PM reads the endpoint
- **THEN** `people[]` has 12 entries

### Requirement: `POST /api/insights/chat` — streaming Claude proxy
The system SHALL expose `POST /api/insights/chat` accepting `{ messages: Array<{ role: 'user' | 'assistant'; content: string }> }` and streaming Server-Sent Events back to the client.

Authorization: PM or admin only (403 otherwise). When `ANTHROPIC_API_KEY` env var is missing, the endpoint returns 503 with a JSON body `{ error: 'Insights chat is not configured. Set ANTHROPIC_API_KEY.' }` (no Anthropic call attempted).

The server MUST proxy the conversation to the Anthropic Messages API using the model from `INSIGHTS_CHAT_MODEL` (default `claude-sonnet-4-6`), with:
- A system prompt explaining read-only access and asking Claude to use markdown links to entities (`[Name](/projects/<id>)` etc.).
- The full tool-use registry from the next requirement.
- `cache_control: { type: 'ephemeral' }` on the system prompt block AND on the tools block, so repeat-turn cost stays low.

The server MUST stream three SSE event types:
- `{ type: 'text_delta', text: '<chunk>' }` for each text fragment.
- `{ type: 'tool_call', name, status: 'started' | 'completed', summary? }` for each tool the model invokes. `summary` MAY be set on `completed` events with a short human-readable description (e.g., `"Read 8 at-risk projects"`).
- `{ type: 'done' }` once the turn ends (Anthropic emits `stop_reason: 'end_turn'`).

The server MUST cap tool calls per request at **10** to prevent runaway loops; the 11th tool request returns an error event and ends the stream.

#### Scenario: Non-PM rejected with 403
- **WHEN** an authenticated Viewer POSTs to `/api/insights/chat`
- **THEN** the response is 403 (no Anthropic call attempted)

#### Scenario: Missing API key returns 503
- **GIVEN** `ANTHROPIC_API_KEY` is unset in the API process env
- **WHEN** a PM POSTs to `/api/insights/chat`
- **THEN** the response is 503 with a JSON error body describing the missing configuration

#### Scenario: Text deltas stream as they arrive
- **GIVEN** a configured chat with a PM viewer
- **WHEN** Claude streams a text response back
- **THEN** the client receives multiple `text_delta` SSE events containing the response chunks, in order

#### Scenario: Tool calls surface as SSE events
- **GIVEN** Claude decides to call `listAtRiskProjects` while answering "which projects are red?"
- **WHEN** the tool runs server-side
- **THEN** the client receives a `tool_call` event with `status: 'started'`, followed by `tool_call` with `status: 'completed'`, with a `summary` describing what was read

#### Scenario: Tool-call cap halts runaway loop
- **GIVEN** Claude requests an 11th tool call within a single request
- **WHEN** the server-side loop reaches the cap
- **THEN** the stream emits an error event and ends; the partial response is preserved

### Requirement: Tool surface for Claude chat
The chat endpoint SHALL register the following tools and make them available to Claude on every request. Each tool wraps an existing read path; no tool performs writes; no tool exposes the raw `harvest_projects.raw.timeEntries` blob (hour-granularity stays out of model context).

Tools:

- **`listProjects`** — input `{ state?, phase?, customerId?, atRiskOnly? }`. Returns a slim list of projects (no nested allocations / raw payloads). Filters compose.
- **`getProject`** — input `{ projectId }`. Returns project detail projected to remove `trackerRaw`, `fieldMapping`, and any Harvest `raw` payload.
- **`listPeople`** — input `{ harvestLinkedOnly?, role? }`. Returns a slim Person list.
- **`getPersonWorkload`** — input `{ personId }`. Returns the same shape as `GET /api/people/:id/workload`.
- **`listCustomers`** — no input. Returns the same shape as `GET /api/customers`.
- **`getCustomerReconciliation`** — input `{ customerId }`. Returns the same shape as `GET /api/customers/:id/reconciliation`.
- **`listAtRiskProjects`** — input `{ includeStale? }`. Wraps `GET /api/risks?include=stale`.
- **`getPortfolioDashboard`** — no input. Wraps `GET /api/dashboard/summary`.
- **`getPeopleOverview`** — no input. Wraps `GET /api/people/overview`.
- **`searchEntities`** — input `{ query }`. Wraps `GET /api/search`.
- **`getInsightsOverview`** — no input. Returns the same payload as `GET /api/insights/overview` so Claude can grab the full picture in one tool call.

Every tool handler MUST run with the viewer's auth context. Tool input schemas MUST be strict JSON schemas (enums where applicable) so Claude can call them reliably without ambiguity.

#### Scenario: Tools cover the page's data needs
- **WHEN** a PM asks "Show me everything red and over budget"
- **THEN** Claude can answer using only `listAtRiskProjects` + `listProjects` (or the single `getInsightsOverview`); no other tool is required

#### Scenario: No write tools exposed
- **GIVEN** the tool registry at startup
- **WHEN** any code inspects it
- **THEN** every registered tool is a read-only wrapper; none mutate database state

#### Scenario: raw.timeEntries never surfaces to Claude
- **WHEN** any tool returns Harvest project data
- **THEN** the response object omits `raw` and omits `breakdown[].people[]` fields that aren't strictly necessary for the analytical answer

### Requirement: Conversation lifecycle is ephemeral
Conversations between the user and Claude SHALL NOT be persisted in v1. The client maintains the messages array in component state; navigating away or refreshing discards it. The server never writes the conversation to the database.

This is an intentional v1 simplification; a follow-up change MAY add per-user persistence with retention rules.

#### Scenario: Refresh kills the conversation
- **GIVEN** a PM has had a 6-message exchange with Claude on the Insights page
- **WHEN** they refresh the page
- **THEN** the chat pane returns to the empty state (suggested prompts visible) with no prior messages
