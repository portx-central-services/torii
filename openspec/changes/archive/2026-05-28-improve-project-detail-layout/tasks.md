## 1. Shared field grouping

- [x] 1.1 Add a `group` tag ('Team' | 'Customer' | 'Systems' | 'Use case' | 'Links') to each entry in `PROJECT_DETAIL_FIELDS` in `apps/web/src/api/endpoints.ts`
- [x] 1.2 Export a helper or ordered grouping derived from `PROJECT_DETAIL_FIELDS` so the detail page builds subgroups from one definition (no second hard-coded list)

## 2. Header & redundancy removal

- [x] 2.1 Replace the four hero stat tiles with a compact read-only status strip: phase badge, state badge, next milestone, tracker badge + last-sync
- [x] 2.2 Remove the standalone side-column "Tracker Sync" panel; fold external id / last-sync into the header meta
- [x] 2.3 Ensure phase/state/target-go-live/tracker-sync each render once (read-only in header where shown; editable only in their editor); drop duplicate renderings
- [x] 2.4 Keep the "Refresh from tracker" button in the header, PM-only and only when linked

## 3. Details subgroups

- [x] 3.1 Rewrite `ProjectDetailsPanel` to render the five labeled subgroups in order (Team, Customer, Systems, Use case, Links), each a small KV block
- [x] 3.2 Preserve link-field anchors and the `—` placeholder for empty fields
- [x] 3.3 Keep the PM-only editor for torii-owned fields, laid out within the subgroups

## 4. Page structure & styles

- [x] 4.1 Reorder the single-page sections: header → Delivery timeline → Project details → Project settings (PM) → Allocations → Monday details (linked)
- [x] 4.2 Replace the two-column main/side grid with full-width grouped sections
- [x] 4.3 Add/adjust `app.css` for the header status strip and details subgroups; remove now-unused hero-tile/side-column rules after confirming no other page uses them

## 6. Header timeline + tracker meta (revision)

- [x] 6.1 Render the delivery timeline as a horizontal stepper inside the header, below the phase/state status; remove the standalone "Delivery timeline" section
- [x] 6.2 Drop the "Next milestone" status item (the horizontal timeline now conveys progression); status strip = phase, state, owner
- [x] 6.3 Move tracker last-sync (+ external id) to small secondary text beneath the "Refresh from tracker" button; render for linked projects even when the button is hidden
- [x] 6.4 Add `app.css` for the horizontal timeline (markers/connectors, done/active/upcoming colors) and the tracker meta subtext

## 7. Header layout refinement

- [x] 7.1 Move the State badge to the top-right of the header; move the Refresh button + sync status to the header footer's lower-right
- [x] 7.2 Move the Phase badge to directly under the project name title
- [x] 7.3 Surface the Team subgroup (PM, SA, SC) in the header footer (lower-left), below the title and the timeline; exclude Team from the Project details section
- [x] 7.4 Render Status Report and Jira Project as accent-colored hyperlinks whose text is the field label (no raw URL); style via `.detail-link`
- [x] 7.5 Anchor the "Edit details" button to the bottom-right of the details card (full-width grid row)
- [x] 7.6 CSS for the header footer, team row, sync corner, and accent link; remove orphaned `.detail-status-strip` / `.detail-hero-actions` rules

## 8. Second header revision

- [x] 8.1 Header top-right: Phase and State badges side by side, with Status Report and Jira Project as accent label-links stacked beneath them
- [x] 8.2 Team roster (PM, SA, SC) moves to directly under the project name title (not the header footer)
- [x] 8.3 Drop the header footer entirely; the header card ends after the horizontal timeline
- [x] 8.4 Move the "Refresh from tracker" button and last-sync/external-id subtext to a small footer at the bottom of the page
- [x] 8.5 Remove Links and Team from the Project details section (both now in the header)
- [x] 8.6 `buildTimeline`: omit `actual_go_live` step when unset; default `hypercare_end` to (`actual_go_live` ?? `target_go_live`) + 4 weeks
- [x] 8.7 `AllocationsPanel` surfaces a read-only Team roster (PM, SA, SC) at the top of the panel
- [x] 8.8 CSS for new header top-right cluster (badges + link column), team row under title, page-bottom sync footer, team roster

## 9. Header balance tweak

- [x] 9.1 Remove the project id + monday provider badge from the top of the header card
- [x] 9.2 Consolidate identifiers (project id, monday provider badge, last-sync, external id) into the page-bottom sync footer as a single muted meta line, with the Refresh button on the right; the footer renders for all projects so `project.id` is always shown
- [x] 9.3 Stack the team members vertically on the left under the title (one row per role) with aligned labels for visual balance against the top-right cluster
- [x] 9.4 Drop the now-unused `.tracker-meta` rule

## 10. Consolidated facets band

- [x] 10.1 Restore the timeline as a full-width focal band; increase marker, label, and connector sizing for prominence
- [x] 10.2 Collapse the header into three vertical bands: title, timeline, facets band
- [x] 10.3 Move Phase, State, Status Report, and Jira Project out of the top-right cluster and into the facets band alongside Team
- [x] 10.4 Render every facet as a uniform label-above-value cell; phase/state values use the badge components; link values use an "Open ↗" accent hyperlink (or `—` when no URL)
- [x] 10.5 Drop the now-unused `.detail-hero-row` / `.detail-hero-title` / `.detail-hero-topright` / `.detail-hero-badges` / `.detail-hero-links` rules; add `.detail-hero-h1`

## 5. Verification

- [x] 5.1 `pnpm --filter @torii/web exec tsc --noEmit` clean
- [x] 5.2 `pnpm --filter @torii/web build` succeeds
- [ ] 5.3 In the running app: open a linked project — confirm no fact (phase/state/target go-live/tracker-sync) appears more than once
- [ ] 5.4 Confirm the twelve details render under the five labeled subgroups, links clickable, empties show `—`
- [ ] 5.5 As PM: edit phase/state, key dates, and a torii-owned detail field — all save and refresh; as Viewer: no edit controls or Refresh button
- [ ] 5.6 Confirm allocations and Monday details still render, and the page is a single scroll (no tabs)
