## 1. Env + dependencies

- [x] 1.1 Add `ANTHROPIC_API_KEY` (string, secret) and `INSIGHTS_CHAT_MODEL` (string, default `'claude-sonnet-4-6'`) to `apps/api/src/env.ts` Zod schema. Both optional in non-production environments so dev `.env` doesn't block API startup.
- [x] 1.2 Add `@anthropic-ai/sdk` (latest stable) to `apps/api/package.json`. Run `pnpm install` at workspace root.
- [x] 1.3 Document the new env vars in `apps/api/.env.example` with brief comments.

## 2. API: insights overview endpoint

- [x] 2.1 New file `apps/api/src/routes/insights.ts` exporting `registerInsightsRoutes({ db, env })`.
- [x] 2.2 `GET /api/insights/overview` — PM-or-admin only (403 otherwise). Response shape per proposal: `{ asOf, kpis, projects, people, trends }`. Aggregations join existing tables — no new DB structures.
- [x] 2.3 **KPIs**: active projects (state ≠ Done), at-risk (latest RAG ≠ Green, state ≠ Done), **recoveredThisWeek** (latest RAG = Green AND previous-week RAG ≠ Green), overBudget, launchingSoon (`target_go_live` within 30d), hours7d + hours30d (org-wide sums from `harvest_projects.raw.timeEntries`), activeCustomers (customers with ≥1 non-Done project).
- [x] 2.4 **Per-project rows**: one per non-Done project. Computed columns: `latestRagLevel` + `weeksStuckAtLevel` from `ProjectRiskUpdate` history (DISTINCT-ON for latest + count backward for streak), `daysInCurrentPhase` from `PhaseAuditLog` last transition, budget/spent/% from summed `HarvestProject` rows pinned to this project, `slipDays = target_go_live − baseline_go_live` (null when either missing), `last30DaysHours` summed across pinned Harvest projects.
- [x] 2.5 **Per-user rows**: one per Harvest-linked person. Columns: `committedPct` (Σ weeklyPct), `availabilityPct`, `defaultCapacityPct`, `last7DaysHours` + `last30DaysHours` from `Person.billedHoursLast30d` for 30d and the helper from `lib/person-harvest-windows.ts` for 7d, `activeProjectCount` from the union helper, `overCommittedBy = max(0, committedPct + availabilityPct − defaultCapacityPct)`.
- [x] 2.6 **Trends**: last 8 ISO weeks (Monday-anchored). `weeklyHours[]` walks `harvest_projects.raw.timeEntries` filtered to the 8-week window, bucketed by ISO week of `spent_date`. `weeklyRag[]` runs `SELECT week_of, rag_level, COUNT(*)` on `project_risk_updates` for the same 8 weeks; output is `{ weekOf, red, amber, green }` per week.
- [x] 2.7 Register the route module in `apps/api/src/app.ts`.

## 3. API: insights chat endpoint

- [x] 3.1 New file `apps/api/src/routes/insights-chat.ts` exporting `registerInsightsChatRoutes({ db, env })`. Returns 503 with a clear JSON error when `ANTHROPIC_API_KEY` is missing.
- [x] 3.2 Define the tool registry: each tool a `{ name, description, input_schema, handler }`. Handlers receive `(input, { db, viewer })` and return a JSON-serializable result. Handlers MUST use the viewer's auth context where applicable (e.g., `listAtRiskProjects` runs unfiltered, but never reveals data the viewer wouldn't see on the corresponding page).
- [x] 3.3 Implement these tool handlers (each wraps an existing read path):
  - `listProjects({ state?, phase?, customerId?, atRiskOnly? })`
  - `getProject({ projectId })`
  - `listPeople({ harvestLinkedOnly?, role? })`
  - `getPersonWorkload({ personId })`
  - `listCustomers()`
  - `getCustomerReconciliation({ customerId })`
  - `listAtRiskProjects({ includeStale? })`
  - `getPortfolioDashboard()`
  - `getPeopleOverview()`
  - `searchEntities({ query })`
  - `getInsightsOverview()` — same bundle the page uses; lets Claude grab the whole picture in one tool call when appropriate.
- [x] 3.4 `POST /api/insights/chat` — PM-or-admin only. Body: `{ messages: Array<{ role: 'user' | 'assistant'; content: string }> }`. Streams Server-Sent Events back; events `{ type: 'text_delta', text }`, `{ type: 'tool_call', name, status: 'started' | 'completed', summary? }`, and `{ type: 'done' }`. Use `reply.raw` for SSE.
- [x] 3.5 System prompt: short ("You're an analyst with read-only access to PortX delivery data…"), tells Claude to keep responses concise, prefer markdown links to entities (`[Project Name](/projects/<id>)`), and to use tools rather than guess.
- [x] 3.6 Apply `cache_control: { type: 'ephemeral' }` on the system prompt + tools block per request.
- [x] 3.7 Tool-use loop server-side: when a `tool_use` block arrives, look up the handler in the registry, invoke it with the viewer context, append the result, continue the stream. Cap at 10 tool calls per turn to avoid infinite loops.
- [x] 3.8 Register the route module in `apps/api/src/app.ts`.

## 4. Shared schemas

- [x] 4.1 Add `InsightsOverviewSchema` to `packages/shared/src/schemas.ts` with the full shape from 2.2. Export `InsightsOverview` type. Skip Zod for the chat endpoint's request/response (custom SSE protocol).

## 5. Web API client

- [x] 5.1 Add `getInsightsOverview()` helper to `apps/web/src/api/endpoints.ts`.
- [x] 5.2 Add `streamInsightsChat({ messages, onEvent, signal })` helper that uses `fetch` against `/api/insights/chat`, reads the SSE stream, parses each event, calls `onEvent(event)` for the consumer. Returns a promise that resolves when the stream completes.

## 6. Web: Insights page

- [x] 6.1 New file `apps/web/src/routes/insights.tsx` exporting `<InsightsPage>`. Two-column layout: left scrollable metrics, right sticky chat. Below 960px viewport: stacked.
- [x] 6.2 Top KPI tile row reading from `kpis`. Includes the new "Recovered this week" tile.
- [x] 6.3 **Per-project metrics table** — sortable on every column. Filters: free-text search by project name (client-side). Numeric columns are right-aligned, tabular-numeric.
- [x] 6.4 **Per-user metrics table** — sortable. Free-text filter by name. Over-commit chip when applicable.
- [x] 6.5 **Trend charts** — two compact charts: weekly hours (vertical bar chart) and weekly RAG distribution (stacked bar). Reuse the visual vocabulary from the existing portfolio dashboard's phase-distribution bar (`.dashboard-stacked-bar-*` classes).
- [x] 6.6 Loading / error states per section so a slow Anthropic stream doesn't block the metrics rendering.

## 7. Web: Chat pane

- [x] 7.1 New component `apps/web/src/components/InsightsChat.tsx`. Local state: `messages: Message[]`, `inFlight: boolean`. No persistence across navigations.
- [x] 7.2 Layout: scrollable message list at top, sticky input + Send button at bottom. Tool-call status lines render inline with each assistant message.
- [x] 7.3 Suggested starter prompt buttons when `messages.length === 0`: "Which projects are red?", "Who's available for new work?", "Show me hours billed by customer last 30 days." Clicking a button stuffs the prompt into the input and submits.
- [x] 7.4 Submit handler: appends the user message, opens an assistant message bubble in "thinking…" state, calls `streamInsightsChat`. Each `text_delta` appends to the assistant bubble; each `tool_call` event appends a small italic line. `done` finalizes the bubble.
- [x] 7.5 Tiny markdown renderer (`renderChatMarkdown(text)`) that handles `**bold**`, `` `code` ``, and `[link](path)` — internal paths route through `<Link>`, external `https?://` open in a new tab.
- [x] 7.6 Error state: if the stream errors mid-flight, append a red "(connection error: <message>)" line and keep prior text intact. Allow the user to retry.
- [x] 7.7 Abort: include an `AbortController` so navigating away or starting a new prompt cancels the in-flight stream.

## 8. Routing + nav

- [x] 8.1 Register `/insights` in `apps/web/src/App.tsx`. Wrap in `<RequirePM>` (existing component pattern).
- [x] 8.2 Add `Insights` to `NavShell.tsx` between `Capacity` and `Trackers`. Hide for non-PM viewers (same `user?.role === 'PM' || user?.isAdmin` check as `Trackers`).
- [x] 8.3 Pick a nav icon — reuse one from `NavIcons.tsx` (Sparkles-style or a chart icon). Add a new one if nothing fits.
- [x] 8.4 Add breadcrumb label for `/insights` ("Insights") in the NavShell crumb switch.

## 9. CSS

- [x] 9.1 New `.insights-page` layout: CSS Grid with `grid-template-columns: minmax(0, 1fr) 420px` at ≥960px; single column below.
- [x] 9.2 `.insights-chat-pane` styles: sticky positioning, scrollable message list, sticky input row.
- [x] 9.3 `.insights-chat-message-user` and `.insights-chat-message-assistant` styles for the message bubbles. Tool-call lines use `.insights-chat-tool-line`.
- [x] 9.4 Reuse `.kpi-row` / `.kpi` for the top tiles. Reuse the dashboard's `.dashboard-stacked-bar*` for the RAG trend chart.

## 10. Spec deltas

- [x] 10.1 `dashboard-views` — ADD `Insights page at /insights` requirement (PM-and-admin gated, metrics + chat split). MODIFY existing `Navigation shell` requirement to insert `Insights` between `Capacity` and `Trackers`.
- [x] 10.2 `insights-chat` (new capability) — ADD `Tool surface for Claude chat`, `GET /api/insights/overview`, `POST /api/insights/chat`, `Conversation lifecycle is ephemeral`, `Server-side tool-use loop with cap`.

## 11. Verification

- [x] 11.1 `pnpm --filter @torii/api test` green. New tests for: insights overview returns the shape from 2.2; KPIs computed correctly on a small mock dataset; recovered-this-week filter excludes projects currently non-Green; chat endpoint 403 for non-PM; chat endpoint 503 when env var missing.
- [x] 11.2 `pnpm --filter @torii/web exec tsc --noEmit` clean.
- [x] 11.3 `pnpm --filter @torii/web build` succeeds.
- [x] 11.4 Manually: open `/insights` as a PM — metrics render, chat pane visible.
- [x] 11.5 Manually: ask "which projects are red?" — Claude calls `listAtRiskProjects`, renders the tool-call line, then a markdown response with clickable project links.
- [x] 11.6 Manually: ask "show me people with less than 50% committed" — Claude calls `getPeopleOverview` or `listPeople` and filters in its answer.
- [x] 11.7 Manually: a Viewer attempting `/insights` is redirected (no access). The `Insights` nav link is absent for them.
- [x] 11.8 Manually: confirm the trend charts render with reasonable bars/heights and that hovering shows tooltips.
- [x] 11.9 Manually: confirm "Recovered this week" tile reflects at least one project where last week was non-Green and this week is Green.
- [x] 11.10 Manually: kill the `ANTHROPIC_API_KEY` env var, restart, confirm the page still loads (metrics work) and the chat pane shows a clear "Chat is not configured" message.
