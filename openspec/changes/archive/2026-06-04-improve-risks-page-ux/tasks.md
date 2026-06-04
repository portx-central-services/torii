## 1. API: extend `/api/risks`

- [x] 1.1 In `apps/api/src/routes/risks.ts`, change the DISTINCT-ON query to also join `customers` (`c.id`, `c.name`) via `projects.customer_id LEFT JOIN customers c ON c.id = p.customer_id`. Return `customerId` (nullable) and `customerName` (nullable) on each row.
- [x] 1.2 Add a `?include=stale` query parameter. When omitted, the response is the existing `RiskListItem[]` array (backwards compatible). When present, the response shape is `{ atRisk: RiskListItem[], stale: StaleRiskRow[] }`.
- [x] 1.3 Compute the `stale[]` array: any project whose `state != Done` AND the most-recent `ProjectRiskUpdate.weekOf` is more than 2 ISO weeks before the current week's Monday (using `isoWeekMondayUTC`). Each row: `{ projectId, projectName, customerId, customerName, lastRagLevel: RagLevel | null, lastWeekOf: ISO-date | null, weeksSinceLastUpdate: number | null }`. Projects with NO updates at all surface with `lastRagLevel: null`, `lastWeekOf: null`, `weeksSinceLastUpdate: null` so the page can show "never updated."
- [x] 1.4 Cap `stale[]` at 100 rows server-side (sort by `weeksSinceLastUpdate` descending with nulls first) so the page never has to render a runaway list.

## 2. Shared schemas

- [x] 2.1 Extend `RiskListItemSchema` in `packages/shared/src/schemas.ts` to include `customerId: z.string().nullable()` and `customerName: z.string().nullable()`.
- [x] 2.2 Add `StaleRiskRowSchema` with the fields from 1.3.
- [x] 2.3 Add `RisksWithStaleSchema` = `z.object({ atRisk: z.array(RiskListItemSchema), stale: z.array(StaleRiskRowSchema) })`.

## 3. Web API client

- [x] 3.1 Update the `listRisks()` helper in `apps/web/src/api/endpoints.ts` to accept an optional `{ includeStale?: boolean }` parameter. Without it, returns `RiskListItem[]`. With it true, returns `{ atRisk, stale }`. Export both types.

## 4. Web: Risks page rewrite

- [x] 4.1 In `apps/web/src/routes/risks.tsx`, switch the page query to `listRisks({ includeStale: true })` so we get both arrays in one round trip.
- [x] 4.2 Build a customer-grouped view: walk `atRisk[]`, partition by `customerId` (with a trailing `__none__` bucket for `customerId == null`), sort groups by customer name with `__none__` last. Each group renders a header (customer name as a link to `/customers/:id`, plus a count chip "N projects · X red · Y amber") and the list of cards beneath.
- [x] 4.3 Keep the KPI tile row at the top — they still answer the at-a-glance count question.
- [x] 4.4 Add a PM-only "Update my week" button to the page header that opens the bulk-update side panel (section 6).
- [x] 4.5 Below the at-risk groups, render the **"Stale updates"** section reading from `stale[]`. Empty state: hidden when the array is empty.

## 5. Web: RiskProjectCard 2-column table + trend + weeks-stuck

- [x] 5.1 In `apps/web/src/routes/risks.tsx` (the shared `<RiskProjectCard>` component), replace the stacked free-text rendering with a 2-column `<dl>`-shaped grid: `Description / History`, `Go-to-green plan`, `Next steps`, `Action Requested`. The `Description / History` cell stacks `description` (top), `latestUpdate` prefixed with a small "This week:" label (middle), and a "View N earlier weeks" disclosure with the existing history accordion contents (bottom).
- [x] 5.2 Add a **trend chip** next to the RAG chip in the card header. Compute from `history.data` per D7: `New` / `Returned from Green` / `Same` / `↑ Worsened from <prev>` / `↓ Improved from <prev>`. Use the existing `.variance-chip-*` palette as a starting point; or add `.trend-chip-*` if the colors need to differ.
- [x] 5.3 Add a **weeks-stuck chip** next to the trend chip when the project has been at the same non-Green level for ≥2 consecutive weeks. Walk the history array backward from the current entry, counting consecutive `ragLevel === current.ragLevel` entries; render `Stuck N weeks at <level>`. Hidden when `N < 2`.
- [x] 5.4 Make sure the new layout also renders correctly on the project detail page (where `<RiskProjectCard linkToProject={false}>` is used).

## 6. Web: PM bulk-update side panel

- [x] 6.1 New component `apps/web/src/components/WeeklyUpdatePanel.tsx`. Props: `open: boolean`, `onClose: () => void`. Visible to PMs only (return null when `useIsPM()` is false).
- [x] 6.2 On open, fetch the list of projects to update: every project where the viewer is `ownerId` / `projectManagerId` / `solutionArchitectId` / `solutionConsultantId` AND no `ProjectRiskUpdate` exists for the current ISO week. Implement via a new endpoint `GET /api/risks/my-week` returning `Array<{ projectId, projectName, projectPhase, customerId?, customerName? }>`, or via a client-side filter on `endpoints.listProjects({})` joined to a new lightweight `GET /api/people/:id/projects-needing-update` — choose the former (one focused endpoint).
- [x] 6.3 Render each row with: project name + phase chip + customer link, inline RAG selector (Red / Amber / Green), inline State selector (Blocked / Inform — disabled when RAG is Green, since green has no state), one-line `latestUpdate` input, one-line `nextSteps` input. RAG defaults to `Green` so the common-case "still good" is one click.
- [x] 6.4 "Save all" button POSTs each row sequentially to the existing `POST /api/projects/:id/risk-updates` endpoint. Successful rows disappear from the panel. Errors stay visible with the error message inline.
- [x] 6.5 On any successful save, invalidate the `['risks']` query so the main page reflects the updates. Close the panel when zero rows remain.
- [x] 6.6 Empty state when zero projects need updating: "You're caught up for this week." with a "Close" button.

## 7. API: bulk-update helper endpoint

- [x] 7.1 Add `GET /api/risks/my-week` returning the projects-needing-update list for the current viewer. Auth: PM only. Response: `Array<{ projectId, projectName, projectPhase, projectState, customerId, customerName }>`. Implementation: find every project where the viewer matches any of the four role FKs AND no `ProjectRiskUpdate` exists with `weekOf === isoWeekMondayUTC(today)`.
- [x] 7.2 Add the helper to the web API client (`endpoints.myWeekProjects()`).
- [x] 7.3 Add `MyWeekProjectSchema` to the shared schemas.

## 8. Spec deltas

- [x] 8.1 `risk-tracking` — MODIFY `At-risk listing endpoint` (adds customer fields, adds `?include=stale` mode, defines stale-row shape). MODIFY `Risks page (web)` (customer grouping, trend chip, weeks-stuck chip, 2-column card details, stale section, bulk update entry). ADD `Bulk weekly update flow` (the side panel + supporting endpoint).

## 9. Verification

- [x] 9.1 `pnpm --filter @torii/api test` green. New tests for: at-risk endpoint emits customerId/customerName; `?include=stale` returns the object form with both arrays; stale threshold is exactly 2 ISO weeks; `/api/risks/my-week` auth gating + filter logic.
- [x] 9.2 `pnpm --filter @torii/web exec tsc --noEmit` clean.
- [x] 9.3 `pnpm --filter @torii/web build` succeeds.
- [ ] 9.4 Manually: open `/risks` — rows cluster under customer headers, projects with no customer trail at the bottom, the count chip on each header is correct.
- [ ] 9.5 Manually: trend chip renders correctly for a "new red" (no prior), a "still red" (same level), and a "returned from green" (last week Green, this week non-Green).
- [ ] 9.6 Manually: a project that's been red for 3+ consecutive weeks shows the "Stuck 3 weeks at Red" chip; a 1-week red does NOT show it.
- [ ] 9.7 Manually: card details render as the 4-row table; the Description / History row carries the standing description, the "This week:" latest update, and the inline history disclosure.
- [ ] 9.8 Manually: PM clicks "Update my week" — panel lists every project they own without a current-week update; saving each row updates the main page in place.
- [ ] 9.9 Manually: a Green project whose last update is 3+ weeks old appears in the "Stale updates" section with the correct `weeksSinceLastUpdate` value; clicking "Update now" opens the bulk panel pre-filtered to that project.
- [ ] 9.10 Manually: a non-PM viewer does NOT see "Update my week" or the stale section's "Update now" button.
