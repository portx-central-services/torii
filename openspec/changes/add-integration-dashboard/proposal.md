## Why

Fintech integration projects are tracked across spreadsheets, Monday.com boards, Slack threads, and PM heads. Program managers cannot answer "what's in flight, what phase, who is at risk, and who is over-allocated?" without manually reconciling several sources. Torii will be the single dashboard PMs and engineering leadership use to read project status and plan team capacity.

## What Changes

- New web app (TypeScript + React + Node.js) deployed as an internal tool.
- Hybrid data model: projects can be imported from an external tracker AND edited inside Torii; per-project field mapping defines which side owns which fields.
- Phase model `Discovery → Build → UAT → Launch → Hypercare`; state `On track / At risk / Blocked / Done` carried independently of phase.
- Capacity planning with team-level rollup as the primary view and per-person allocation drill-down.
- SSO sign-in via Google/Okta OIDC; PM vs. viewer roles gate edit operations.
- Pluggable tracker-adapter interface; **Monday.com** ships as the reference adapter in this change. Jira and Linear adapters are explicit follow-on changes.

## Capabilities

### New Capabilities
- `project-lifecycle`: Create, view, and edit fintech integration projects with phase, state, key dates, and ownership.
- `capacity-planning`: Per-person allocations over time windows; team rollup, per-person drill-down, over-allocation warnings.
- `tracker-import`: Pluggable adapter interface with a Monday.com implementation; periodic + on-demand sync; field-ownership rules between Torii and the tracker.
- `dashboard-views`: Filterable list view, project detail view, and capacity view that surface project-lifecycle and capacity-planning data.
- `sso-auth`: Google/Okta OIDC sign-in, session management, role-based authorization (PM, viewer).

### Modified Capabilities
- None (greenfield repository).

## Non-goals

- Jira and Linear adapters — separate follow-on changes (`add-jira-adapter`, `add-linear-adapter`).
- Forecasting, burn-down analytics, or historical trend reporting.
- Mobile-native UI; responsive web is sufficient for MVP.
- Multi-tenant / external-customer access.
- Bidirectional write-back to Monday.com.

## Impact

- **Affected teams**:
  - **PMO** — primary daily users; need onboarding.
  - **Integration Engineering** — consumers of dashboard views; allocation targets.
  - **Platform / IT** — host the app, provision SSO, manage Monday.com OAuth credentials.
- **New code**: pnpm workspace with `apps/web` (Vite + React + TS), `apps/api` (Node + TS), `packages/shared` (types). Postgres schema. SSO middleware.
- **External dependencies**: Monday.com OAuth app + API token; Google or Okta OIDC client.
- **APIs introduced**: internal REST API under `/api` for projects, people, allocations, capacity rollup, and tracker sync.

## Rollback plan

Internal tool with no upstream consumers. Rollback steps:
1. Disable the SSO client and remove the deployment.
2. Drop the Torii Postgres schema (no other system reads it).
3. Revoke the Monday.com OAuth app credentials.
No data migration is required from any system, so rollback is purely operational.
