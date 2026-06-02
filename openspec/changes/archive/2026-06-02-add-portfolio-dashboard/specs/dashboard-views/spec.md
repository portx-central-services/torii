## MODIFIED Requirements

### Requirement: Navigation shell
The system SHALL render a persistent navigation shell with the order **Dashboard → Timeline → Risks → Projects → Capacity → Trackers**. The shell MUST show the signed-in user's name and a sign-out action. The Trackers link MUST be visible only to admins.

The header band (Torii logo + nav links) MUST be sticky to the top of the viewport so it remains visible while the main content scrolls. The signed-in user footer MUST be sticky to the bottom of the viewport so it remains visible regardless of page length. The main content scroll region sits between the two sticky bands. Both bands MUST have a solid background so scrolling content does not bleed through.

#### Scenario: Nav order
- **GIVEN** any authenticated user opens any page
- **WHEN** the nav shell renders
- **THEN** the visible links appear in the order Dashboard, Timeline, Risks, Projects, Capacity (and Trackers when the user is admin)

#### Scenario: Dashboard is the default landing
- **GIVEN** an authenticated user opens `/`
- **WHEN** the route resolves
- **THEN** the Portfolio Dashboard page renders (no redirect to `/projects`)

#### Scenario: Header sticky on long pages
- **GIVEN** a user on `/projects` with rows that overflow the viewport
- **WHEN** the user scrolls the page
- **THEN** the header band (logo + nav links) remains visible at the top of the viewport at every scroll position

#### Scenario: User footer sticky on long pages
- **GIVEN** the same scrolled page
- **WHEN** the user scrolls toward the bottom
- **THEN** the signed-in user band remains visible at the bottom of the viewport at every scroll position

#### Scenario: Admin sees Trackers link
- **GIVEN** an authenticated user with `PM` role and `is_admin=true`
- **WHEN** any page is rendered
- **THEN** the navigation includes a `Trackers` link

#### Scenario: Non-admin does not see Trackers link
- **GIVEN** an authenticated user with `is_admin=false`
- **WHEN** any page is rendered
- **THEN** the `Trackers` link is not present in the navigation

#### Scenario: Risks and Timeline are visible to all authenticated users
- **GIVEN** any authenticated user (PM or Viewer)
- **WHEN** any page is rendered
- **THEN** the navigation includes both `Risks` and `Timeline` links

## ADDED Requirements

### Requirement: Portfolio Dashboard page at `/`
The system SHALL provide a Portfolio Dashboard at the root path `/` accessible to every authenticated user. The page is read-only — no edit affordances. Every numeric value on the page that represents a project or person count MUST be a clickable link that navigates to the drill-down view containing those projects/people.

The page MUST contain the following sections in order:

1. **Hero KPI band** — 6 clickable tiles, in this order:
   - **Active**: count of projects whose `state` is not `Done`. Click → `/projects`.
   - **At risk**: count of distinct projects whose most-recent `ProjectRiskUpdate` has `ragLevel != Green` AND `state != Done`. Click → `/risks`.
   - **Over budget**: count of projects where `overBudget === true`. Click → `/projects`.
   - **Launching ≤ 30d**: count of projects with `keyDates.target_go_live` set, within 30 days of today, and `state != Done`. Click → `/projects`.
   - **Avg slip**: average `(actual_go_live − baseline_go_live)` in days across Done projects with both dates set. Click → `/projects`.
   - **People involved**: count of distinct Person rows appearing as PM/SA/SC on any non-Done project. Non-interactive (no link until a `/people` index page exists).

2. **This week's risk picture** — Red / Amber / Green chips with the count of distinct projects whose most-recent weekly RAG is at that level. Each chip MUST show the previous-week's count as muted subtext. Red and Amber chips MUST link to `/risks`; the Green chip MUST NOT be clickable.

3. **Schedule pressure** — a list of every project with `keyDates.target_go_live` set within 30 days of today AND `state != Done`. Sorted ascending by date. Each row MUST show: project name (link to `/projects/:id`), the date, days-until-target, phase badge, RAG chip (when an at-risk update exists), and over-budget chip (when `overBudget`). Empty state when nothing is launching in the window.

4. **Needs attention** — two side-by-side cards:
   - **No risk update this week**: active projects (`state != Done`) with no `ProjectRiskUpdate` row for the current ISO week. Each row: project name (link), latest RAG (any week, or "no prior update"), weeks-since-last-update. Sort: worst latest RAG first, then weeks-since-last-update descending.
   - **Slipping**: projects where `target_go_live > baseline_go_live` AND `state != Done`. Each row: project name (link), baseline date, current target date, slip days (in red). Sorted by slip-days descending. Limited to 30 rows.

5. **Phase distribution** — a horizontal stacked bar with one segment per `Phase` value, segment widths proportional to the count of active projects in that phase. Uses the seven-phase color palette established by the Timeline page. Hovering a segment MUST show a tooltip with the phase label and the count.

#### Scenario: Default landing is the dashboard
- **GIVEN** an authenticated user opens `/`
- **WHEN** the page resolves
- **THEN** the Portfolio Dashboard renders (it is no longer a redirect to `/projects`)

#### Scenario: Hero KPI tile links to its drill-down
- **GIVEN** the user is on the dashboard
- **WHEN** they click the "At risk" tile
- **THEN** the browser navigates to `/risks`

#### Scenario: Green RAG chip is not clickable
- **GIVEN** the dashboard is rendered
- **WHEN** the user clicks the Green-week chip
- **THEN** no navigation occurs (the chip has no link target)

#### Scenario: Schedule pressure surfaces launching projects in order
- **GIVEN** three projects with `target_go_live` of `today+5d`, `today+15d`, and `today+25d` (all non-Done)
- **WHEN** the dashboard renders
- **THEN** the schedule-pressure list shows all three rows ordered ascending by date

#### Scenario: Schedule pressure excludes far-future projects
- **GIVEN** a project with `target_go_live` 60 days from today
- **WHEN** the dashboard renders
- **THEN** that project is NOT in the schedule-pressure list

#### Scenario: No-risk-update list surfaces active projects without a current-week update
- **GIVEN** project A has a `ProjectRiskUpdate` for the current ISO week; project B does not (and is not Done)
- **WHEN** the dashboard renders
- **THEN** project B appears in the "No risk update this week" card; project A does not

#### Scenario: Slipping list shows positive slip only
- **GIVEN** project A with `baseline_go_live = 2026-08-01` and `target_go_live = 2026-09-15` (slipped); project B with `target_go_live = 2026-07-15` (pulled in)
- **WHEN** the dashboard renders
- **THEN** project A appears in the slipping list; project B does not

#### Scenario: Avg-slip KPI uses Done projects only
- **GIVEN** several Done projects with both `baseline_go_live` and `actual_go_live` set, and other in-flight projects with `baseline_go_live` and `target_go_live` set
- **WHEN** the dashboard's "Avg slip" KPI is computed
- **THEN** only the Done projects contribute; in-flight projects are excluded (they're reflected in the "Slipping" list instead)

#### Scenario: Phase distribution renders all seven segments
- **GIVEN** active projects span every phase except `Production`
- **WHEN** the phase-distribution bar renders
- **THEN** six segments render with widths proportional to their counts; the `Production` segment is zero-width (or hidden) and does not break the bar

### Requirement: `GET /api/dashboard/summary` aggregation endpoint
The system SHALL expose `GET /api/dashboard/summary` returning the data required by the Portfolio Dashboard in a single response. Accessible to any authenticated user. The response shape MUST be:

```ts
{
  kpis: {
    active: number;
    atRisk: number;
    overBudget: number;
    launchingSoon: number;
    avgSlipDays: number | null;  // null when no Done projects have both dates set
    peopleInvolved: number;
  };
  thisWeekRag: {
    red: number; amber: number; green: number;
    prevRed: number; prevAmber: number; prevGreen: number;
  };
  schedulePressure: Array<{
    projectId: string;
    projectName: string;
    targetGoLive: string;       // ISO yyyy-mm-dd
    daysUntil: number;
    phase: Phase;
    ragLevel: RagLevel | null;  // most-recent non-Green latest week, or null
    overBudget: boolean;
  }>;
  noRiskUpdate: Array<{
    projectId: string;
    projectName: string;
    latestRagLevel: RagLevel | null;
    weeksSinceLastUpdate: number | null;
  }>;
  slipping: Array<{
    projectId: string;
    projectName: string;
    baselineGoLive: string;     // ISO yyyy-mm-dd
    targetGoLive: string;       // ISO yyyy-mm-dd
    slipDays: number;           // positive integer
  }>;
  phaseCounts: Record<Phase, number>;
}
```

The endpoint MUST NOT require any query parameters. All sub-queries MUST scope appropriately: `active` means `state != Done` everywhere; risk counts use the same `DISTINCT ON (project_id) ORDER BY week_of DESC` shape `/api/risks` uses.

#### Scenario: Endpoint returns the full summary in one call
- **WHEN** an authenticated user reads `GET /api/dashboard/summary`
- **THEN** the response is a single JSON object containing every top-level key above; no key is missing

#### Scenario: `avgSlipDays` is null when no Done project has both dates
- **GIVEN** zero Done projects have both `baseline_go_live` AND `actual_go_live` set
- **WHEN** the endpoint is called
- **THEN** `kpis.avgSlipDays` is `null`

#### Scenario: `phaseCounts` includes zero buckets
- **GIVEN** no active projects are in `Production` phase
- **WHEN** the endpoint is called
- **THEN** `phaseCounts.Production` is `0` (the key is present, the value is zero)

#### Scenario: Unauthenticated request is rejected
- **WHEN** an unauthenticated client reads the endpoint
- **THEN** the response is 401
