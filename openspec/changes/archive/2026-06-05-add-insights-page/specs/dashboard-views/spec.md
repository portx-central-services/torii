## MODIFIED Requirements

### Requirement: Navigation shell
The system SHALL render a persistent navigation shell with the order **Dashboard → Timeline → Risks → Customers → Projects → People → Capacity → Insights → Trackers**. The shell MUST show the signed-in user's name and a sign-out action. The `Trackers` AND `Insights` links MUST be visible only to users with role `PM` or `isAdmin === true`.

The header band (Torii logo + nav links) MUST be sticky to the top of the viewport so it remains visible while the main content scrolls. The signed-in user footer MUST be sticky to the bottom of the viewport so it remains visible regardless of page length. The main content scroll region sits between the two sticky bands. Both bands MUST have a solid background so scrolling content does not bleed through.

#### Scenario: Nav order
- **GIVEN** any authenticated user opens any page
- **WHEN** the nav shell renders
- **THEN** the visible links appear in the order Dashboard, Timeline, Risks, Customers, Projects, People, Capacity (plus Insights and Trackers when the user has the PM role or is an admin)

#### Scenario: Dashboard is the default landing
- **GIVEN** an authenticated user opens `/`
- **WHEN** the route resolves
- **THEN** the Portfolio Dashboard page renders

#### Scenario: Insights is hidden from Viewers
- **GIVEN** an authenticated user with role `Viewer` (`is_admin = false`)
- **WHEN** any page is rendered
- **THEN** the navigation does NOT include the `Insights` link

#### Scenario: Insights is visible to PMs
- **GIVEN** an authenticated user with role `PM`
- **WHEN** any page is rendered
- **THEN** the navigation includes the `Insights` link (positioned between `Capacity` and `Trackers`)

#### Scenario: Insights is visible to admins (even when role is Viewer)
- **GIVEN** an authenticated user with `is_admin = true` and role `Viewer`
- **WHEN** any page is rendered
- **THEN** the navigation includes the `Insights` link

#### Scenario: Customers and People are visible to non-admin users
- **GIVEN** any authenticated user
- **WHEN** any page is rendered
- **THEN** the navigation includes the `Customers` and `People` links

#### Scenario: Header sticky on long pages
- **GIVEN** a user on `/projects` with rows that overflow the viewport
- **WHEN** the user scrolls the page
- **THEN** the header band remains visible at the top of the viewport at every scroll position

#### Scenario: User footer sticky on long pages
- **GIVEN** the same scrolled page
- **WHEN** the user scrolls toward the bottom
- **THEN** the signed-in user band remains visible at the bottom of the viewport at every scroll position

#### Scenario: Admin sees Trackers link
- **GIVEN** an authenticated user with `is_admin = true`
- **WHEN** any page is rendered
- **THEN** the navigation includes a `Trackers` link

#### Scenario: Risks and Timeline are visible to all authenticated users
- **GIVEN** any authenticated user (PM or Viewer)
- **WHEN** any page is rendered
- **THEN** the navigation includes both `Risks` and `Timeline` links

## ADDED Requirements

### Requirement: Insights page at `/insights`
The system SHALL provide an Insights page at `/insights` accessible ONLY to users with role `PM` or `isAdmin === true`. Viewers attempting the route MUST be redirected away or receive a 403 from any data endpoint backing the page; the link MUST NOT appear in the navigation for them.

The page MUST render a two-pane layout at viewport widths ≥ 960px:
- **Left pane (≈60% width)**: scrollable metrics, top-to-bottom — KPI tile row, per-project metrics table, per-user metrics table, trend charts.
- **Right pane (≈40% width, ~420px target)**: sticky Claude chat pane (see capability `insights-chat`).

Below 960px the panes stack vertically: metrics on top, chat below.

**KPI tile row** MUST include, at minimum:
- Active projects (state ≠ Done)
- At risk (latest weekly RAG ≠ Green AND state ≠ Done)
- **Recovered this week** — projects whose latest `ProjectRiskUpdate.weekOf = current ISO Monday` has `ragLevel = Green` AND whose previous-week update has `ragLevel ≠ Green`. Surfaces "we got better this week" alongside the at-risk count.
- Over budget (Σ spent across pinned Harvest projects > Σ budget)
- Launching ≤ 30 days
- Hours billed (last 7 days, org-wide)
- Hours billed (last 30 days, org-wide)
- Active customers (customers with ≥1 non-Done project)

**Per-project metrics table** MUST be sortable on every rendered column. One row per project where `state ≠ Done`. Columns: project name (link), customer (link), phase, state, latest RAG chip, weeks-stuck-at-current-RAG, days in current phase (from `PhaseAuditLog`), budget hours, spent hours, percent of budget, slip days (`target_go_live − baseline_go_live`, null when either date missing), last-30-days hours.

**Per-user metrics table** MUST be sortable on every column. One row per Harvest-linked person. Columns: name (link), role chip, committed % (Σ `weeklyPct`), available % (`availabilityPct`), default capacity %, last 7 days hours, last 30 days hours, active project count (the same union the Workload section uses), over-commit chip when `committed + availability > default`.

**Trend charts** MUST render two compact charts side-by-side (or stacked on narrow viewports):
1. **Hours billed per week** — last 8 ISO weeks (Monday-anchored), org-wide. Vertical bar chart; week label below each bar; tooltip showing the exact total.
2. **RAG distribution per week** — last 8 ISO weeks. Stacked bar per week (Red/Amber/Green segments proportional to count).

All metrics MUST read from a single new server endpoint `GET /api/insights/overview` (see capability `insights-chat`) so the page renders in one round trip.

#### Scenario: Viewer cannot access /insights
- **GIVEN** an authenticated user with role `Viewer` and `is_admin = false`
- **WHEN** they navigate to `/insights`
- **THEN** the page does not render (route is gated); the `Insights` nav link is also absent

#### Scenario: PM sees the full page
- **GIVEN** an authenticated user with role `PM`
- **WHEN** they navigate to `/insights`
- **THEN** the KPI tile row, both metrics tables, the trend charts, and the chat pane all render

#### Scenario: Recovered KPI surfaces a project that turned Green this week
- **GIVEN** project A's most recent `ProjectRiskUpdate.weekOf = currentMonday` has `ragLevel = Green` and its previous week's update has `ragLevel = Red`
- **WHEN** the Insights page renders
- **THEN** project A contributes to the "Recovered this week" tile count

#### Scenario: Recovered KPI excludes projects that have been Green the whole time
- **GIVEN** project B's latest two `ProjectRiskUpdate` rows are both `Green`
- **WHEN** the page renders
- **THEN** project B is NOT counted in "Recovered this week"

#### Scenario: Trend chart bars render with 8 weeks of data
- **GIVEN** weekly hours and weekly RAG distribution data exist for the last 8 ISO weeks
- **WHEN** the trend charts render
- **THEN** each chart shows exactly 8 bars/segments, oldest week on the left, current week on the right

#### Scenario: Per-project table sort by weeks-stuck
- **GIVEN** several at-risk projects with different `weeksStuckAtLevel` values
- **WHEN** the PM clicks the "Weeks stuck" column header twice (asc, then desc)
- **THEN** rows reorder by `weeksStuckAtLevel` descending; projects with zero/null stuck-count sort last

#### Scenario: Chat pane stacks below metrics on narrow viewports
- **GIVEN** the viewport is < 960px wide
- **WHEN** the page renders
- **THEN** the chat pane appears below the metrics column, not beside it
