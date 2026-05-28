## Context

The project detail view ([apps/web/src/routes/project-detail.tsx](apps/web/src/routes/project-detail.tsx)) grew organically: a hero with four stat tiles, a main column (Delivery timeline → Project settings editor → Project details), a side column (Tracker Sync → Key dates), then full-width Allocations and Monday details. The same facts surface repeatedly and the twelve `details` fields are a flat grid. This change is a presentation-only reorganization driven by two goals: stronger hierarchy and no duplicated facts.

## Goals / Non-Goals

**Goals:**
- One canonical home per fact; the header summarizes status without re-stating editable values.
- Group the twelve `details` into labeled subgroups.
- Single scrolling page; preserve all existing behaviors and permissions.

**Non-Goals:**
- Tabs, route splits, new data, or any backend change.
- Changing field existence, sync, or ownership.

## Decisions

### Single home for each fact (redundancy map)

Today's duplication and the target single home:

| Fact | Appears now in | Canonical home after |
|------|----------------|----------------------|
| Phase | hero badge, hero tile, settings editor | header status strip (read) + settings editor (edit) |
| State | hero badge, hero tile, settings editor | header status strip (read) + settings editor (edit) |
| Target go-live | hero tile, timeline, key-dates panel | timeline + key-dates panel |
| Tracker sync/last-sync | hero tile, side "Tracker Sync" panel | header meta (badge + last-sync) |
| Owner / external id | hero, side panel | header meta |

The header keeps a compact, read-only status strip (phase badge, state badge, next milestone, tracker badge + last-sync). The four standalone hero stat tiles are removed; their unique value (next milestone, last-sync) folds into the header. Editable controls remain only in their editor panels — the header never duplicates an editable value as a separate tile.

**Alternative considered:** keep the stat tiles but de-dupe values elsewhere. Rejected — the tiles are the main source of repetition and equal-weight clutter.

### Details subgroups

`ProjectDetailsPanel` renders five labeled subgroups in a defined order, each a small KV block; empty fields still render with `—` so the structure is stable. Link fields (`status_report_url`, `jira_project_url`) remain anchors. The PM editor continues to edit only torii-owned fields, now laid out within the same subgroups.

Grouping (single source so list/detail stay consistent): the existing `PROJECT_DETAIL_FIELDS` in [endpoints.ts](apps/web/src/api/endpoints.ts) gains a `group` tag (Team, Customer, Systems, Use case, Links) so the panel derives subgroups from one definition rather than a second hard-coded list.

### Section order (single page)

1. Header (identity + read-only status strip + Refresh button for PM/linked)
2. Delivery timeline
3. Project details (five subgroups)
4. Project settings (phase/state + key dates editor, PM only)
5. Allocations
6. Monday details (when linked)

Rationale: status first, then schedule, then the descriptive details users came to read, then edit controls, then allocations and raw tracker data last. The two-column main/side split is dropped in favor of full-width grouped sections, which reads more cleanly once duplication is gone.

### Timeline in the header, tracker meta under the refresh action (revision)

The delivery timeline moves into the header as a **horizontal** stepper directly below the phase/state status, rather than a separate vertical section. This makes schedule progression part of the at-a-glance summary and removes a full standalone section. With the horizontal timeline carrying progression, the "next milestone" status item is dropped (it duplicated the timeline's active step).

The tracker's last-sync (and external id) move out of the header status strip to **small secondary text beneath the "Refresh from tracker" button** in the header actions. The text renders for linked projects even when the button is hidden (viewers), so last-sync visibility is preserved without a dedicated tile or side panel. Net header status strip = phase, state, owner.

## Risks / Trade-offs

- **Behavior regressions during reshuffle** → Mitigation: keep the existing child components (editor, allocations, Monday panel, timeline) intact; this change moves and regroups them, it does not rewrite their internals. Manual verification covers PM edit, viewer read-only, and link rendering.
- **List/detail grouping drift** → Mitigation: add the `group` tag to the shared `PROJECT_DETAIL_FIELDS` rather than a second list, so both pages read one definition.
- **CSS spillover** → Mitigation: scope new styles to detail-view class names; remove now-unused hero-tile/side-column rules only after confirming no other page uses them.

## Migration Plan

Pure front-end. Ship `project-detail.tsx` + `app.css` together; no migration, no flag. Rollback is a revert of those two files.

## Open Questions

- Should empty detail subgroups (all fields blank) be hidden entirely, or shown with `—` placeholders? Assume shown for layout stability; revisit if it feels noisy.
- Should the header status strip show a derived "health" indicator beyond `state`? Out of scope unless requested.
