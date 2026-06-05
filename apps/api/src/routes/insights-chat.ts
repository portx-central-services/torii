import type { FastifyInstance, FastifyRequest } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { ForbiddenError } from '@torii/shared';
import type { DB } from '../db.js';
import type { Env } from '../env.js';
import { requirePM } from '../plugins/guards.js';
import { buildInsightsOverview } from '../lib/insights-overview.js';

const MAX_TOOL_CALLS_PER_TURN = 10;

const chatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      }),
    )
    .min(1),
});

interface ToolContext {
  db: DB;
}

interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  handler: (input: unknown, ctx: ToolContext) => Promise<unknown>;
  /** Optional human-readable summary built from the result for the `completed` SSE event. */
  summarize?: (result: unknown) => string | undefined;
}

interface RegisterInsightsChatOptions {
  db: DB;
  env: Env;
}

const SYSTEM_PROMPT = `You are an analyst with read-only access to PortX's delivery data via the listed tools. Be concise.

When mentioning a project, customer, or person, include a markdown link in the form \`[Name](/projects/<id>)\` (or \`/customers/<id>\` / \`/people/<id>\`) so users can click through.

Always use a tool to look up data rather than guessing. Prefer \`getInsightsOverview\` when a question covers the whole portfolio; reach for narrower tools (\`listAtRiskProjects\`, \`getProject\`, etc.) when scoped.`;

// ----- Tool registry --------------------------------------------------------

function projectStateEnum(): string[] {
  return ['OnTrack', 'AtRisk', 'Blocked', 'Done'];
}

function phaseEnum(): string[] {
  return [
    'Backlog',
    'Initiation',
    'Design',
    'Development',
    'UAT',
    'GoLiveReadiness',
    'Production',
  ];
}

/** Project a Project row to the analytical fields Claude needs. Drops `trackerRaw`,
 *  `fieldMapping`, and any nested Harvest `raw` payloads (hour granularity stays
 *  out of model context per D12 / spec). */
function projectAnalyticalView<
  T extends {
    id: string;
    name: string;
    phase: string;
    state: string;
    customerId: string | null;
    customer?: { id: string; name: string } | null;
    keyDates: unknown;
    details?: unknown;
    projectManagerId?: string | null;
    solutionArchitectId?: string | null;
    solutionConsultantId?: string | null;
    ownerId?: string | null;
    harvestProjects?: Array<{
      id: string;
      name: string;
      budgetHours: unknown;
      spentHoursBillable: unknown;
      spentHoursNonbillable: unknown;
      isBillable: boolean;
    }>;
  },
>(p: T) {
  return {
    id: p.id,
    name: p.name,
    phase: p.phase,
    state: p.state,
    customerId: p.customerId,
    customerName: p.customer?.name ?? null,
    keyDates: p.keyDates,
    ownerId: p.ownerId ?? null,
    projectManagerId: p.projectManagerId ?? null,
    solutionArchitectId: p.solutionArchitectId ?? null,
    solutionConsultantId: p.solutionConsultantId ?? null,
    // Strip the multi-system `details` payload to the fields Claude can actually
    // use — drop status URLs and the like that bloat tokens.
    details: (p.details ?? {}) as Record<string, unknown>,
    harvestProjects: (p.harvestProjects ?? []).map((hp) => ({
      id: hp.id,
      name: hp.name,
      isBillable: hp.isBillable,
      budgetHours: hp.budgetHours === null ? null : Number(hp.budgetHours),
      spentHoursBillable: Number(hp.spentHoursBillable),
      spentHoursNonbillable: Number(hp.spentHoursNonbillable),
    })),
  };
}

function buildTools(): ToolDefinition[] {
  return [
    {
      name: 'listProjects',
      description:
        'List projects in Torii. Filters compose (AND). Returns slim rows — for full project detail call getProject.',
      input_schema: {
        type: 'object',
        properties: {
          state: { type: 'string', enum: projectStateEnum() },
          phase: { type: 'string', enum: phaseEnum() },
          customerId: { type: 'string' },
          atRiskOnly: {
            type: 'boolean',
            description:
              "When true, only returns projects whose latest weekly RAG is Red or Amber and whose state is not Done.",
          },
        },
        additionalProperties: false,
      },
      handler: async (raw, { db }) => {
        const input = z
          .object({
            state: z.enum(['OnTrack', 'AtRisk', 'Blocked', 'Done']).optional(),
            phase: z
              .enum([
                'Backlog',
                'Initiation',
                'Design',
                'Development',
                'UAT',
                'GoLiveReadiness',
                'Production',
              ])
              .optional(),
            customerId: z.string().optional(),
            atRiskOnly: z.boolean().optional(),
          })
          .parse(raw);

        const where: Record<string, unknown> = {};
        if (input.state) where.state = input.state;
        if (input.phase) where.phase = input.phase;
        if (input.customerId) where.customerId = input.customerId;

        const projects = await db.project.findMany({
          where,
          include: { customer: { select: { id: true, name: true } } },
          orderBy: { name: 'asc' },
        });

        let filtered = projects;
        if (input.atRiskOnly) {
          // Fetch latest RAG per project once.
          const latestRows = await db.$queryRaw<
            Array<{ project_id: string; rag_level: 'Red' | 'Amber' | 'Green' }>
          >`
            SELECT DISTINCT ON (project_id) project_id, rag_level
            FROM project_risk_updates
            ORDER BY project_id, week_of DESC
          `;
          const latestByProject = new Map(
            latestRows.map((r) => [r.project_id, r.rag_level] as const),
          );
          filtered = projects.filter((p) => {
            if (p.state === 'Done') return false;
            const rag = latestByProject.get(p.id);
            return rag !== undefined && rag !== 'Green';
          });
        }

        return filtered.map((p) => ({
          id: p.id,
          name: p.name,
          phase: p.phase,
          state: p.state,
          customerId: p.customerId,
          customerName: p.customer?.name ?? null,
        }));
      },
      summarize: (result) =>
        Array.isArray(result) ? `Read ${result.length} project(s)` : undefined,
    },
    {
      name: 'getProject',
      description:
        'Get full detail for a single project by id, projected to the analytical fields (no raw tracker payload).',
      input_schema: {
        type: 'object',
        properties: { projectId: { type: 'string' } },
        required: ['projectId'],
        additionalProperties: false,
      },
      handler: async (raw, { db }) => {
        const { projectId } = z.object({ projectId: z.string() }).parse(raw);
        const project = await db.project.findUnique({
          where: { id: projectId },
          include: {
            customer: { select: { id: true, name: true } },
            harvestProjects: {
              select: {
                id: true,
                name: true,
                isBillable: true,
                budgetHours: true,
                spentHoursBillable: true,
                spentHoursNonbillable: true,
              },
            },
          },
        });
        if (!project) return { error: `Project ${projectId} not found` };
        const latest = await db.projectRiskUpdate.findFirst({
          where: { projectId },
          orderBy: { weekOf: 'desc' },
          select: {
            weekOf: true,
            ragLevel: true,
            riskTypes: true,
            state: true,
            description: true,
          },
        });
        return {
          ...projectAnalyticalView(project),
          latestRiskUpdate: latest
            ? {
                weekOf: latest.weekOf.toISOString().slice(0, 10),
                ragLevel: latest.ragLevel,
                riskTypes: latest.riskTypes,
                state: latest.state,
                description: latest.description,
              }
            : null,
        };
      },
      summarize: (result) => {
        if (
          result &&
          typeof result === 'object' &&
          'name' in result &&
          typeof (result as { name?: unknown }).name === 'string'
        ) {
          return `Read project "${(result as { name: string }).name}"`;
        }
        return undefined;
      },
    },
    {
      name: 'listPeople',
      description:
        'List people in Torii. Set harvestLinkedOnly to filter to people whose Harvest user is linked.',
      input_schema: {
        type: 'object',
        properties: {
          harvestLinkedOnly: { type: 'boolean' },
          role: { type: 'string', enum: ['PM', 'Viewer'] },
        },
        additionalProperties: false,
      },
      handler: async (raw, { db }) => {
        const input = z
          .object({
            harvestLinkedOnly: z.boolean().optional(),
            role: z.enum(['PM', 'Viewer']).optional(),
          })
          .parse(raw);
        const where: Record<string, unknown> = {};
        if (input.harvestLinkedOnly) where.harvestUserId = { not: null };
        if (input.role) where.role = input.role;
        const people = await db.person.findMany({
          where,
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            isAdmin: true,
            harvestUserId: true,
            defaultCapacityPct: true,
            availabilityPct: true,
            billedHoursLast30d: true,
          },
        });
        return people.map((p) => ({
          ...p,
          billedHoursLast30d:
            p.billedHoursLast30d === null ? null : Number(p.billedHoursLast30d),
        }));
      },
      summarize: (result) =>
        Array.isArray(result) ? `Read ${result.length} people` : undefined,
    },
    {
      name: 'getPersonWorkload',
      description:
        'Fetch the workload view for one person (per-project weeklyPct, allocatedPct, last 7 / last 30 day hours).',
      input_schema: {
        type: 'object',
        properties: { personId: { type: 'string' } },
        required: ['personId'],
        additionalProperties: false,
      },
      handler: async (raw, { db }) => {
        const { personId } = z.object({ personId: z.string() }).parse(raw);
        const { computePersonHarvestWindows } = await import(
          '../lib/person-harvest-windows.js'
        );
        const person = await db.person.findUnique({ where: { id: personId } });
        if (!person) return { error: `Person ${personId} not found` };
        const windows = await computePersonHarvestWindows(db, person.harvestUserId);
        return {
          personId: person.id,
          name: person.name,
          harvestUserId: person.harvestUserId,
          defaultCapacityPct: person.defaultCapacityPct,
          availabilityPct: person.availabilityPct,
          totals: windows.totals,
          perProject7d: Object.fromEntries(windows.perProject7d),
          perProject30d: Object.fromEntries(windows.perProject30d),
        };
      },
    },
    {
      name: 'listCustomers',
      description: 'List all customers with project and lifetime-hours counts.',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
      handler: async (_input, { db }) => {
        const customers = await db.customer.findMany({
          orderBy: { name: 'asc' },
          include: {
            _count: { select: { projects: true, harvestProjects: true } },
            harvestProjects: {
              select: { spentHoursBillable: true, spentHoursNonbillable: true },
            },
          },
        });
        return customers.map((c) => ({
          id: c.id,
          name: c.name,
          harvestClientId: c.harvestClientId,
          mondayProjectCount: c._count.projects,
          harvestProjectCount: c._count.harvestProjects,
          lifetimeHours: Number(
            c.harvestProjects
              .reduce(
                (sum, hp) =>
                  sum + Number(hp.spentHoursBillable) + Number(hp.spentHoursNonbillable),
                0,
              )
              .toFixed(2),
          ),
        }));
      },
      summarize: (result) =>
        Array.isArray(result) ? `Read ${result.length} customer(s)` : undefined,
    },
    {
      name: 'listAtRiskProjects',
      description:
        'List projects whose latest weekly RAG is Red or Amber. Set includeStale to also surface projects with no recent risk update.',
      input_schema: {
        type: 'object',
        properties: { includeStale: { type: 'boolean' } },
        additionalProperties: false,
      },
      handler: async (raw, { db }) => {
        const { includeStale } = z
          .object({ includeStale: z.boolean().optional() })
          .parse(raw);
        const latestRows = await db.$queryRaw<
          Array<{
            project_id: string;
            project_name: string;
            customer_id: string | null;
            customer_name: string | null;
            week_of: Date;
            rag_level: 'Red' | 'Amber' | 'Green';
          }>
        >`
          SELECT DISTINCT ON (r.project_id)
            r.project_id,
            p.name AS project_name,
            c.id   AS customer_id,
            c.name AS customer_name,
            r.week_of,
            r.rag_level
          FROM project_risk_updates r
          JOIN projects p ON p.id = r.project_id
          LEFT JOIN customers c ON c.id = p.customer_id
          WHERE p.state <> 'Done'
          ORDER BY r.project_id, r.week_of DESC
        `;
        const atRisk = latestRows
          .filter((r) => r.rag_level !== 'Green')
          .map((r) => ({
            projectId: r.project_id,
            projectName: r.project_name,
            customerId: r.customer_id,
            customerName: r.customer_name,
            weekOf: r.week_of.toISOString().slice(0, 10),
            ragLevel: r.rag_level,
          }));
        if (!includeStale) return atRisk;
        // Stale = active projects without a current-week update (defined loosely here as
        // no update in the latest week we've seen). Cheap approximation; the dashboard
        // endpoint has the strict math if Claude needs it.
        const allActive = await db.project.findMany({
          where: { state: { not: 'Done' } },
          select: {
            id: true,
            name: true,
            customer: { select: { id: true, name: true } },
          },
        });
        const haveUpdate = new Set(latestRows.map((r) => r.project_id));
        const stale = allActive
          .filter((p) => !haveUpdate.has(p.id))
          .map((p) => ({
            projectId: p.id,
            projectName: p.name,
            customerId: p.customer?.id ?? null,
            customerName: p.customer?.name ?? null,
            ragLevel: null,
          }));
        return { atRisk, stale };
      },
      summarize: (result) => {
        if (Array.isArray(result)) return `Read ${result.length} at-risk project(s)`;
        if (
          result &&
          typeof result === 'object' &&
          'atRisk' in result &&
          Array.isArray((result as { atRisk?: unknown }).atRisk)
        ) {
          const r = result as { atRisk: unknown[]; stale?: unknown[] };
          return `Read ${r.atRisk.length} at-risk, ${r.stale?.length ?? 0} stale`;
        }
        return undefined;
      },
    },
    {
      name: 'getInsightsOverview',
      description:
        'Return the same aggregated payload the Insights page renders (KPIs, per-project rows, per-user rows, 8-week trends). Use this when the question spans the whole portfolio.',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
      handler: async (_input, { db }) => buildInsightsOverview(db),
      summarize: () => 'Read portfolio overview',
    },
  ];
}

// ----- Route ----------------------------------------------------------------

export function registerInsightsChatRoutes(
  app: FastifyInstance,
  opts: RegisterInsightsChatOptions,
): void {
  const { db, env } = opts;

  const tools = buildTools();
  const toolsByName = new Map(tools.map((t) => [t.name, t] as const));
  const anthropicTools: Anthropic.Messages.Tool[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Messages.Tool.InputSchema,
  }));

  app.post('/api/insights/chat', async (request: FastifyRequest, reply) => {
    requirePM(request);

    if (!env.ANTHROPIC_API_KEY) {
      reply.code(503);
      return {
        error: 'Insights chat is not configured. Set ANTHROPIC_API_KEY.',
      };
    }

    const body = chatRequestSchema.parse(request.body);

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

    // SSE headers + raw stream access for chunked event emission.
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.hijack();

    const send = (event: Record<string, unknown>): void => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const conversationMessages: Anthropic.Messages.MessageParam[] = body.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    let toolCallCount = 0;
    let aborted = false;
    request.raw.on('close', () => {
      aborted = true;
    });

    try {
      // Server-side tool-use loop. Each iteration opens a stream; if the model
      // ends the turn with tool_use blocks we run the tools, append the results
      // as a new user turn, and loop. We exit when stop_reason === 'end_turn'.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (aborted) break;

        // Prompt caching: mark the system block + tools ephemeral so repeat
        // turns stay cheap. Cache placement is the last system block (D3).
        const stream = client.messages.stream({
          model: env.INSIGHTS_CHAT_MODEL,
          max_tokens: 4096,
          system: [
            {
              type: 'text',
              text: SYSTEM_PROMPT,
              cache_control: { type: 'ephemeral' },
            },
          ],
          tools: anthropicTools.map((t, i, arr) =>
            i === arr.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t,
          ),
          messages: conversationMessages,
        });

        stream.on('text', (delta: string) => {
          if (aborted) return;
          send({ type: 'text_delta', text: delta });
        });

        const finalMessage = await stream.finalMessage();
        if (aborted) break;

        // Append the assistant turn for tool-use continuity.
        conversationMessages.push({
          role: 'assistant',
          content: finalMessage.content,
        });

        if (finalMessage.stop_reason === 'end_turn') break;

        if (finalMessage.stop_reason !== 'tool_use') {
          // Anything else (max_tokens, refusal, …) ends the stream.
          break;
        }

        const toolUses = finalMessage.content.filter(
          (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
        );
        if (toolUses.length === 0) break;

        const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
        for (const tu of toolUses) {
          if (toolCallCount >= MAX_TOOL_CALLS_PER_TURN) {
            send({
              type: 'error',
              message: `Tool-call cap of ${MAX_TOOL_CALLS_PER_TURN} reached`,
            });
            aborted = true;
            break;
          }
          toolCallCount++;
          const def = toolsByName.get(tu.name);
          send({ type: 'tool_call', name: tu.name, status: 'started' });
          if (!def) {
            const errMsg = `Unknown tool: ${tu.name}`;
            send({ type: 'tool_call', name: tu.name, status: 'completed', summary: errMsg });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: errMsg,
              is_error: true,
            });
            continue;
          }
          try {
            const result = await def.handler(tu.input, { db });
            const summary = def.summarize?.(result);
            send({ type: 'tool_call', name: tu.name, status: 'completed', summary });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: JSON.stringify(result),
            });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            request.log.error({ err, tool: tu.name }, 'insights chat tool failed');
            send({ type: 'tool_call', name: tu.name, status: 'completed', summary: `error: ${errMsg}` });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: `Tool error: ${errMsg}`,
              is_error: true,
            });
          }
        }

        if (aborted) break;
        conversationMessages.push({ role: 'user', content: toolResults });
      }

      if (!aborted) send({ type: 'done' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      request.log.error({ err }, 'insights chat stream failed');
      try {
        send({ type: 'error', message });
      } catch {
        // ignore; the socket may already be closed
      }
    } finally {
      try {
        reply.raw.end();
      } catch {
        // already closed
      }
    }
  });

  // Quiet unused-warning when only callers above reference these.
  void ForbiddenError;
}
