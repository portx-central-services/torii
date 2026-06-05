## Why

Torii surfaces *every* relevant signal — project state, allocations, Harvest hours, risk RAG, customer rollups, person workloads — but each lives behind its own page. When a PM wants to answer "show me everyone who's over-committed AND working on a Red project this week," the answer is in the data but takes 5 clicks across 3 pages to assemble.

This change adds **`/insights`**, a single PM-only page that:

1. **Compacts every relevant aggregation** into one tabular view — portfolio KPIs, per-project metrics, per-user metrics, trend charts.
2. **Adds a Claude chat pane** alongside the metrics. Ask in plain English; Claude calls predefined read-only tools against Torii's data and answers with citations. "Which projects are red and over budget?" "Who has < 50% committed and is Harvest-linked?" "What's Aaron's load look like this week?" — all natural-language queries that today require multi-page navigation.

The chat is **not** a replacement for the existing surfaces; it's a fast-path for cross-cutting questions. The metrics tables stay even when the chat is collapsed.

## What Changes

### `/insights` — new PM-only page

Layout: split-pane. Left ≈60% scrollable metrics column; right ≈40% sticky chat pane. Below ~960px viewport, the chat moves below the metrics (stacked).

**Left column sections, top to bottom:**

1. **Portfolio overview KPIs** — dense tile row including:
   - Active projects (state ≠ Done)
   - At risk (latest RAG ≠ Green)
   - Recovered this week (latest RAG = Green AND previous-week RAG ≠ Green)
   - Over budget (Σ spent > Σ budget across pinned Harvest projects)
   - Launching ≤ 30 days
   - Hours billed (last 7d / last 30d, org-wide)
   - Customers with active projects
2. **Per-project metrics table** — one row per non-Done project, sortable on every column. Columns: name, customer, phase, state, RAG (latest), weeks-stuck, days-in-phase, budget hours, spent hours, % of budget, slip days (`target − baseline`), 30d hours total.
3. **Per-user metrics table** — one row per Harvest-linked person, sortable. Columns: name, role, committed %, available %, 7d billed, 30d billed, project count, over-commit chip.
4. **Trend charts** — two compact charts:
   - **Hours billed per week** for the last 8 ISO weeks, org-wide. Bar chart.
   - **RAG distribution per week** for the last 8 weeks. Stacked-bar (Red/Amber/Green segments).

All sections read from existing endpoints aggregated into one new `GET /api/insights/overview` so the page renders in a single round trip.

**Right column: Claude chat pane.**

- **Streaming Claude responses** via the Anthropic Messages API.
- **Predefined tools** Claude can call to read Torii data — see "Tool surface" below.
- **Tool-call transparency**: each tool invocation renders inline in the chat as a small "→ Looking up …" line so the user sees Claude's work.
- **Suggested starter prompts** as buttons above the input on a fresh conversation: "Which projects are red?", "Who's available for new work?", "Show me hours billed by customer last 30 days."
- **Conversation is ephemeral** (lives in component state). Refresh kills it. Persistence is a future change.
- **Auth + scoping**: server-side endpoint requires PM role and proxies the call to Anthropic — never exposes the API key to the browser. Every tool the model can call uses the same read paths the PM can already access from the rest of the app, so chat answers reflect the same data they would see otherwise. No new exposure.

### Tool surface (server-side, Claude can call)

Each tool wraps an existing Torii API endpoint or a tightly-scoped query:

- `listProjects({ state?, phase?, customerId?, atRiskOnly? })`
- `getProject({ projectId })` — full detail including Harvest hours / customer / risk history
- `listPeople({ harvestLinkedOnly?, role? })`
- `getPersonWorkload({ personId })` — same shape as `/api/people/:id/workload`
- `listCustomers()` + `getCustomerReconciliation({ customerId })`
- `listAtRiskProjects({ includeStale? })` — wraps `/api/risks?include=stale`
- `getPortfolioDashboard()` — wraps `/api/dashboard/summary`
- `getPeopleOverview()` — wraps `/api/people/overview`
- `searchEntities({ query })` — wraps `/api/search`
- `getInsightsOverview()` — the same bundle the page itself uses

No SQL access. No write tools. No tool that returns the Harvest `raw.timeEntries` blob (hour-level granularity stays out of model context).

### `GET /api/insights/overview` — single aggregation endpoint

Returns a structured response containing every metric the page renders, plus the trend-chart series. Lifts heavy aggregation into the server (one query, joined) rather than fanning out to existing endpoints.

Shape (sketch):

```ts
{
  asOf: ISO timestamp,
  kpis: { activeProjects, atRisk, recoveredThisWeek, overBudget, launchingSoon, hours7d, hours30d, activeCustomers },
  projects: Array<{ projectId, projectName, customerId, customerName, phase, state, latestRagLevel, weeksStuckAtLevel, daysInCurrentPhase, budgetHours, spentHours, pctOfBudget, slipDays, last30DaysHours }>,
  people: Array<{ personId, name, role, isAdmin, committedPct, availabilityPct, defaultCapacityPct, last7DaysHours, last30DaysHours, activeProjectCount, overCommittedBy }>,
  trends: {
    weeklyHours: Array<{ weekOf, hours }>,        // last 8 weeks
    weeklyRag: Array<{ weekOf, red, amber, green }>, // last 8 weeks
  },
}
```

### `POST /api/insights/chat` — streaming Anthropic proxy

PM-only. Accepts `{ messages: Array<{ role: 'user' | 'assistant'; content: string }> }`. Streams Anthropic's Server-Sent Events back to the client (text deltas + tool_use blocks). Server handles the tool-use loop: when Claude requests a tool call, the server invokes the corresponding helper, appends the tool result, and continues the stream. Client renders deltas + tool-call summaries as they arrive.

Uses Anthropic prompt caching (cache_control on the system prompt + tool definitions) so the per-turn cost stays low.

### Schema, env, nav

- **Schema**: no new tables in v1.
- **Env**: new `ANTHROPIC_API_KEY` env var (required when the insights chat is enabled; the chat endpoint returns 503 with a clear error when the key is missing). New `INSIGHTS_CHAT_MODEL` env var with a default of `claude-sonnet-4-6` so the model can be swapped without code.
- **Nav**: add `Insights` between **Capacity** and **Trackers**. PM + admin only (the Insights link is hidden for Viewers, same gating pattern as Trackers).
- **Dependencies**: add `@anthropic-ai/sdk` to `apps/api`.

### Out of scope (deferred — called out in spec non-goals)

- **Conversation history persistence**. Chats are ephemeral in v1.
- **Cost / usage display**. We'll trust Anthropic billing.
- **Write tools** (e.g., "set this project's state to Done"). Read-only only.
- **SQL tool**. The predefined-tools surface covers v1 questions; a SQL escape hatch can come later if real questions don't map to existing endpoints.
- **Per-user rate limiting on the chat**. PM scale at PortX (a handful of PMs) doesn't warrant it; if usage grows, add a per-user cap.
- **Trend charts beyond 8 weeks**. The window can be made configurable in a future change.
- **Comparing data over arbitrary date ranges**. v1 ships fixed windows (7d, 30d, last 8 weeks).
- **Embedding chat on other pages**. Chat lives at `/insights` only in v1.
- **Cross-customer comparisons** as a structured table (e.g., "which customer is hottest"). Possible via the chat; not a structured table in v1.

## Capabilities

### Modified Capabilities

- `dashboard-views` — adds the `/insights` page requirement; modifies the Navigation shell requirement to insert `Insights` between Capacity and Trackers (PM-and-admin gated).

### Added Capabilities

- `insights-chat` — new capability covering the Claude chat endpoint, tool surface, and conversation handling.

## Impact

- **New code**: 1 new GET aggregation endpoint, 1 new POST chat endpoint with streaming + tool-use loop, 1 new page with three table sections + two chart components + a chat pane, server-side tool registry.
- **DB**: no schema changes.
- **API contracts**: 2 new endpoints; existing endpoints unchanged.
- **Env**: 2 new env vars (`ANTHROPIC_API_KEY`, `INSIGHTS_CHAT_MODEL`).
- **Dependencies**: `@anthropic-ai/sdk` (or `@anthropic-ai/sdk-typescript`) added to `apps/api`. No new web-side dependencies — markdown rendering uses a small handrolled subset (bold + links + inline code) to avoid pulling a full library.

## Non-goals

- No chat persistence in v1.
- No write/mutation tools.
- No SQL or freeform DB access for Claude.
- No fancy charting library; trend charts use small inline SVG (same shape as the existing portfolio dashboard's stacked bar).
- No automatic refresh of the metrics — React Query default refetch-on-focus is enough.

## Rollback plan

Pure additive. To roll back: remove the two endpoints, the page, the nav entry, the env vars, and the SDK dependency. No data state.

## Affected teams

- **PMO** — primary users. Two-pane page becomes a daily landing alongside the existing Dashboard.
- **Engineering** — review the tool surface before merging. Each tool is a thin wrapper over an existing endpoint; the read-only constraint is what makes this safe.
- **Platform / IT** — set the new env vars (`ANTHROPIC_API_KEY`, optionally `INSIGHTS_CHAT_MODEL`).
