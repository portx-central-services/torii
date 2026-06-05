## Constraints

- ~200 active projects + ~64 people + ~30 customers at PortX scale. The Insights endpoint joins all three plus weekly aggregates — well within "single request" territory; no caching tier needed in v1.
- Anthropic's Messages API supports streaming, tool use, and prompt caching natively. The SDK (`@anthropic-ai/sdk`) handles the tool-use loop nicely; we don't roll our own.
- The chat endpoint runs on Fastify. Streaming an SSE response from inside a Fastify route is supported but requires `reply.raw` access — the route can't use the typed-response helper for that one endpoint.
- Every existing API endpoint enforces auth via `requireUser` / `requirePM` / `requireAdmin`. The chat tools must do the same so a PM's chat can't reach Admin-only data.

## Decisions

### D1 — Curated tool surface, not SQL

A SQL tool would be more flexible, but every observable v1 question maps to an existing endpoint. Wrapping those endpoints as ~10 named tools gets us four wins:

- **Safety** — Claude can't accidentally `JOIN ... CROSS APPLY` its way into a 30-second query or expose data the requesting PM shouldn't see.
- **Observability** — tool calls render inline ("→ Looking up at-risk projects…"). Users see exactly what Claude did. SQL strings would be too noisy to surface inline.
- **Cost control** — predefined tool results are bounded in size. A SQL tool's result blob could be tens of thousands of rows, blowing up the conversation context.
- **Reuse** — every tool is a thin wrapper over an HTTP endpoint we already test. No new query paths.

A SQL escape hatch is a future change if real questions stop mapping to predefined tools.

### D2 — Streaming responses with tool-use loop server-side

The chat endpoint MUST stream. Anthropic responses take 2–6 seconds; without streaming the chat reads as broken. The server-side loop:

1. Receive `{ messages }` from the client.
2. Open a stream to Anthropic with the system prompt + tools + messages.
3. Forward text deltas to the client over SSE.
4. When Claude emits a `tool_use` block, run the corresponding tool, append the result, and resume the stream.
5. Keep looping until Claude emits `stop_reason: 'end_turn'`.

Each tool call produces an SSE event of `type: 'tool_call'` so the client can render the "→ Looking up …" indicator. Text deltas produce `type: 'text_delta'` events. The client buffers + appends to the in-flight assistant message.

### D3 — Prompt cache aggressively

Anthropic's prompt cache pays off when the system prompt + tool definitions repeat across turns. We mark both with `cache_control: { type: 'ephemeral' }` on every request. At our usage scale, the cache TTL (5 minutes) covers normal back-and-forth perfectly and drops cost per turn substantially.

System prompt anchor: "You are an analyst with read-only access to PortX delivery data via the listed tools. Be concise. When mentioning a project/customer/person, include a markdown link in the form `[name](/projects/<id>)` etc. so users can click through."

### D4 — Sonnet 4.6 as the default model

Cost/speed/quality trade-off:
- Sonnet 4.6 is fast (≈1.5–3s for typical tool-using turns) and inexpensive.
- The questions Claude needs to answer are analytical, not deeply creative — Sonnet's intelligence is more than sufficient.
- Opus 4.7 would slow the turn meaningfully and cost ~5× more without obvious quality gain for this kind of structured-data Q&A.

The model name is in an env var (`INSIGHTS_CHAT_MODEL`) so it's swappable without code.

### D5 — Ephemeral conversation in v1

No DB persistence. Refresh kills the chat. Reasoning:
- Persistence is its own design problem (per-user scoping, expiration, what counts as a "conversation").
- Ephemeral is correct for the discovery-style usage we expect at first.
- Persistence is an additive change later — the client already maintains the messages array, so wiring it to a DB table is a small follow-up.

### D6 — Server-side proxy, never expose the API key

The chat endpoint runs server-side. The client posts the conversation; the server adds the API key and streams Anthropic's response back. Standard pattern; no need for client-side credentials.

The server endpoint also enforces PM-or-admin auth: even though the tools are read-only and respect the requesting user's permissions, we don't want non-PM users running up an Anthropic bill on PortX's account.

### D7 — Tool transparency in the UI

Tool calls render in the chat as small italicized lines:

```
→ Looking up at-risk projects…
→ Read 8 projects.
```

The first line appears as soon as the `tool_use` block is emitted; the second appears once the tool result returns. Both are styled subtly so they don't compete with Claude's actual response. The user sees Claude's working memory without needing to expand anything.

This also makes hallucinations easy to spot — if Claude claims "Acme has 5 over-budget projects" but no tool call was visible, the user knows to verify.

### D8 — Markdown rendering uses a tiny in-house subset

Pulling a full markdown library (marked, remark, etc.) for a single use site is overkill. We render:

- `**bold**` → `<strong>`
- `` `code` `` → `<code>`
- `[link](/path)` → `<Link>` (react-router-dom Link for internal paths; `<a target="_blank">` for external URLs)

That's it. Headings, lists, tables — the chat doesn't need them. If a Claude response uses them, they render as plain text. Acceptable for v1.

### D9 — Insights endpoint runs aggregate queries on every page load

No caching layer. With ~200 projects and ~64 people, the aggregations complete in well under 200ms. React Query default refetch-on-focus is sufficient freshness.

### D10 — Trend chart windows are fixed at 8 ISO weeks

Configurable windows are a future change. Eight weeks gives ~2 months of history — enough to spot trends without overwhelming a tile-sized chart. The window anchors on ISO weeks the same way every other Torii date-bucket does.

### D11 — Insights page is PM-and-admin only

Same gating as `/trackers`: the nav link is hidden for Viewers, and the page route returns 403 when accessed directly. The chat endpoint enforces PM-or-admin at the API layer. We chose PM-only rather than fully open because:
- The chat consumes paid Anthropic tokens; restricting to PMs caps the bill predictably.
- The metrics surface itself reads the same data anyone can see, but concentrating it on one page makes "show me the whole portfolio at once" a slightly stronger surface — it's the kind of read most useful to delivery leadership.

If Viewers later need access, lifting the gate is a one-line change.

### D12 — Tool result serialization stays small

Each tool result we send back to Claude is the JSON shape of the existing endpoint's response. Some endpoints (e.g., `/api/projects/:id`) return rich nested data — when sent verbatim, that's a lot of tokens. The tool wrappers project to the fields Claude actually needs for analytical questions:

- `getProject` → drops `trackerRaw`, drops `details.field_mapping`, drops Harvest `raw` payload, keeps everything else.
- `getPersonWorkload` → keeps it as-is (already compact).
- `listProjects` → already returns slim rows.

When a real question needs a field we projected away, the tool's response shape gets extended.
