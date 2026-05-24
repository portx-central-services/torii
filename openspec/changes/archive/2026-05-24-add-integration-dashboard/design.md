## Context

Torii is a greenfield TypeScript/React/Node project. This first change must establish the application architecture, the data model, the SSO mechanism, the tracker-adapter abstraction, and the Monday.com reference adapter, plus the dashboard and capacity UIs.

Primary stakeholders: PMO (daily users), Integration Engineering (subjects of allocation data), Platform/IT (host the app, manage SSO and Monday.com OAuth credentials).

Constraints:
- Internal-only deployment behind SSO; not multi-tenant.
- Data sources are heterogeneous (Monday.com initially; Jira and Linear are planned follow-ons), so the sync layer MUST be provider-agnostic from day one.
- PMs need to override status fields without the next sync overwriting them — field ownership is a first-class concept, not an after-thought.

## Goals / Non-Goals

**Goals:**
- A pnpm-managed monorepo with three packages: `apps/web` (React + Vite), `apps/api` (Node + Fastify), `packages/shared` (TS types + adapter interface).
- A relational schema in Postgres that supports projects, people, allocations, tracker connections, field mappings, and an audit log.
- A `TrackerAdapter` interface in `packages/shared`, with a registry + sync engine in `apps/api`, and a Monday.com adapter as the first concrete implementation.
- SSO via Google/Okta OIDC with role-based authorization at the API layer.
- A capacity rollup endpoint that returns weekly demand and per-person commitment in one round trip.
- A dashboard SPA with list view, detail view, capacity view, and an admin "Trackers" page.

**Non-Goals:**
- Jira and Linear adapters (separate changes).
- Bidirectional write-back to Monday.com.
- Forecasting, historical trend analytics, mobile-native UI, multi-tenancy.

## Decisions

### D1. Monorepo with pnpm workspaces (vs. single package / Nx / Turborepo)
Choose pnpm workspaces. Shared types between web and API are best-served by a workspace package (`packages/shared`); pnpm is light, fast, and avoids Turborepo's caching layer that we don't need at this size. Re-evaluate if build time grows past ~30 s.

### D2. API framework: Fastify (vs. Express, NestJS)
Choose Fastify. Built-in schema validation (TypeBox or Zod-via-fastify-type-provider) matches our preference for strict request validation; performance is fine; smaller surface than Nest. Express is fine but every request handler needs a hand-rolled validator. Nest is too much ceremony for this scope.

### D3. ORM: Prisma (vs. Drizzle, Kysely)
Choose Prisma. Migrations, types, and tooling are first-class. Drizzle is appealing but the team is more likely to know Prisma; choose familiarity. Kysely is too low-level for a greenfield team.

### D4. Auth: `@fastify/oauth2` + custom OIDC handlers (vs. NextAuth-style library, Passport)
Choose `@fastify/oauth2` plus a thin OIDC verification layer using `openid-client`. Standard, well-supported, no framework lock-in. Passport works but is Express-flavored.

### D5. Sync architecture: pull-based, in-process scheduler with on-demand triggers (vs. external queue, webhooks)
Pull-based on a 30-minute interval per `TrackerConnection`, plus an on-demand "Refresh" action. In-process scheduler (`node-cron`) is sufficient at this scale (single instance, < 100 active connections). When we add a second instance, move to a queue (BullMQ + Redis). Monday.com webhooks are a future enhancement; pull is simpler and predictable.

### D6. Field ownership at row-level granularity (vs. provider-wins or Torii-wins globally)
Each Project carries a `field_mapping` row that declares per-field ownership. This is the core invariant that lets PMs override `phase`/`state` without losing them on the next sync. Defaults: `name` and `target_go_live` owned by Monday; everything else owned by Torii.

### D7. Capacity computation: server-side weekly bucketing (vs. client-side)
Compute weekly buckets server-side and return aggregated JSON. Avoids shipping every allocation row to the client; lets the rollup endpoint be the single source of truth for both API consumers and the capacity view.

### D8. Database: Postgres (vs. SQLite, MySQL)
Postgres. JSONB for `key_dates` and `field_mapping`, range types not needed at MVP scale but available later, well-supported by Prisma. SQLite would prevent multi-process deployment later.

## Architecture

```
+------------------+         +------------------------------+
|  React SPA       | <-----> |  Fastify API                 |
|  (apps/web)      |  HTTP   |  (apps/api)                  |
|                  |         |   - /api/auth (OIDC)         |
|  routes:         |         |   - /api/projects            |
|   /projects      |         |   - /api/people              |
|   /projects/:id  |         |   - /api/allocations         |
|   /capacity      |         |   - /api/capacity/rollup     |
|   /trackers      |         |   - /api/tracker/connections |
+------------------+         |   - sync engine + cron       |
                             +---------------+--------------+
                                             |
                  +--------------------------+---------------+
                  |                                          |
            +-----v-----+                          +---------v---------+
            | Postgres  |                          | Monday.com API     |
            | (Prisma)  |                          | (GraphQL, OAuth2)  |
            +-----------+                          +--------------------+
```

## Data Model

| Table | Columns (key ones) |
|-------|-------------------|
| `Project` | `id`, `name`, `phase`, `state`, `key_dates` JSONB, `owner_id`, `tracker_ref` (provider, external_id; nullable), `field_mapping` JSONB, `created_at`, `updated_at` |
| `Person` | `id`, `name`, `email` unique, `role` enum (`PM`/`Viewer`), `default_capacity_pct`, `is_admin` bool |
| `Allocation` | `id`, `project_id` FK, `person_id` FK, `pct`, `start`, `end` |
| `TrackerConnection` | `id`, `provider` (`monday`), `workspace`, `access_token_enc`, `refresh_token_enc`, `status`, `last_synced_at` |
| `PhaseAuditLog` | `id`, `project_id`, `from_phase`, `to_phase`, `actor_id`, `at` |
| `Session` | `id`, `person_id`, `expires_at` |

Indexes: `Allocation(person_id, start, end)`, `Allocation(project_id, start, end)`, `Project(tracker_ref->>'external_id')`.

## Sequence diagrams

### Initial Monday.com import

```
Admin              Web              API (sync)           Postgres        Monday.com
  |  "Connect"      |                  |                    |                 |
  |---------------->|                  |                    |                 |
  |                 |  POST /tracker   |                    |                 |
  |                 |  /connections    |                    |                 |
  |                 |----------------->|                    |                 |
  |                 |                  |  OAuth redirect    |                 |
  |                 |<-----------------|------------------------------------->|
  |  consent        |                                                         |
  |-------------------------------------------------------------------------->|
  |                 |  callback w/ code|                    |                 |
  |                 |----------------->|                    |                 |
  |                 |                  |  exchange code     |                 |
  |                 |                  |------------------------------------->|
  |                 |                  |  access_token      |                 |
  |                 |                  |<-------------------------------------|
  |                 |                  |  INSERT conn       |                 |
  |                 |                  |------------------->|                 |
  |                 |  201 ok          |                    |                 |
  |                 |<-----------------|                    |                 |
  |  "Import items" |                  |                    |                 |
  |---------------->|                  |                    |                 |
  |                 |  POST /tracker   |                    |                 |
  |                 |  /import         |                    |                 |
  |                 |----------------->|                    |                 |
  |                 |                  |  adapter.list      |                 |
  |                 |                  |------------------------------------->|
  |                 |                  |  items[]           |                 |
  |                 |                  |<-------------------------------------|
  |                 |                  |  UPSERT projects   |                 |
  |                 |                  |------------------->|                 |
```

### PM edits phase while a Monday-owned field is being synced

```
PM                  Web              API                Postgres
  |  PATCH phase     |                |                    |
  |----------------->|                |                    |
  |                  | PATCH /projects|                    |
  |                  |/:id  phase:UAT |                    |
  |                  |--------------->|                    |
  |                  |                | role=PM? yes       |
  |                  |                | UPDATE Project     |
  |                  |                | set phase='UAT'    |
  |                  |                |------------------->|
  |                  |                | INSERT             |
  |                  |                | PhaseAuditLog      |
  |                  |                |------------------->|
  |                  |  200 ok        |                    |
  |                  |<---------------|                    |

[meanwhile, scheduled sync ticks]
sync-engine                                            Postgres        Monday.com
  | adapter.getProject(external_id)                       |              |
  |--------------------------------------------------------------------->|
  | item                                                  |              |
  |<---------------------------------------------------------------------|
  | read field_mapping: phase owner = "torii" => SKIP     |
  | read field_mapping: name owner = "monday" => UPDATE   |
  |------------------------------------------------------>|
```

### Capacity over-allocation flag

```
Client                  API                          Postgres
  | GET /api/capacity/rollup?from=&to=                   |
  |---------------------------------------------------->|
  |                       |  SELECT allocations         |
  |                       |  WHERE end>=from            |
  |                       |    AND start<=to            |
  |                       |---------------------------->|
  |                       |  rows                       |
  |                       |<----------------------------|
  |                       |  bucket by ISO week         |
  |                       |  sum pct per (person,week)  |
  |                       |  compare to default_capacity|
  |                       |  attach over_allocated flag |
  |  JSON {weeks:[...]}   |                             |
  |<----------------------|                             |
```

## Risks / Trade-offs

- **Risk**: Field-ownership defaults will not satisfy every team → **Mitigation**: expose `field_mapping` as editable per project in a follow-on change once we see real usage.
- **Risk**: In-process `node-cron` scheduler won't scale past one instance → **Mitigation**: move to BullMQ + Redis when we add horizontal scaling; document this trip-wire in code.
- **Risk**: Monday.com rate limits or token revocations cause silent drift → **Mitigation**: `TrackerConnection.status` enum (`ok`/`rate_limited`/`auth_failed`); surface in admin UI; alert via logs.
- **Risk**: Auto-provisioning all SSO sign-ins as `Viewer` could open the door to anyone in the allowed domain → **Mitigation**: `ALLOWED_EMAIL_DOMAINS` plus a clear admin-promote workflow.
- **Trade-off**: Prisma is heavier than Drizzle but the team learns one less unfamiliar tool. Acceptable.

## Migration Plan

- **Deployment**: this is a new app; `prisma migrate deploy` against an empty database; seed an initial admin Person from `ADMIN_EMAIL` env var.
- **Rollback**: tear down the deployment, drop the schema, revoke OAuth client and Monday.com app. No upstream consumers to coordinate with.

## Open Questions

1. **Where do Monday.com OAuth client credentials live?** Suggest 1Password vault `Torii / Production` with environment injection at deploy time.
2. **Hosting target** — internal k8s, Fly.io, or Render? Affects the Postgres choice and the secret-management story but does not change application code.
3. **Phase mapping from Monday.com** — what board column should map to phase, if any? Default to "no mapping" (Torii owns phase) and let teams opt in.
