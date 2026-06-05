import type { Phase, ProjectState, RagLevel } from '@prisma/client';
import { deriveProjectType, type ProjectType } from '@torii/shared';
import type { DB } from '../db.js';
import { isoWeekMondayUTC, toIsoDateUTC } from './iso-week.js';
import { buildPeopleNameIndex, secondariesForProject } from './role-secondaries.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const TREND_WEEKS = 8;
const LAUNCH_WINDOW_DAYS = 30;

interface KeyDates {
  baseline_go_live?: string;
  target_go_live?: string;
  actual_go_live?: string;
}

function parseIsoDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

export interface InsightsOverview {
  asOf: string;
  kpis: {
    activeProjects: number;
    atRisk: number;
    recoveredThisWeek: number;
    overBudget: number;
    launchingSoon: number;
    hours7d: number;
    hours30d: number;
    activeCustomers: number;
  };
  projects: Array<{
    projectId: string;
    projectName: string;
    customerId: string | null;
    customerName: string | null;
    phase: Phase;
    state: ProjectState;
    /** Derived from `details.fintech_parent`; matches the projectType field on the project endpoints. */
    projectType: ProjectType;
    latestRagLevel: RagLevel | null;
    weeksStuckAtLevel: number;
    daysInCurrentPhase: number | null;
    budgetHours: number | null;
    spentHours: number | null;
    pctOfBudget: number | null;
    slipDays: number | null;
    last30DaysHours: number;
  }>;
  people: Array<{
    personId: string;
    name: string;
    email: string;
    role: 'PM' | 'Viewer';
    isAdmin: boolean;
    harvestUserId: string | null;
    defaultCapacityPct: number;
    availabilityPct: number;
    committedPct: number;
    last7DaysHours: number | null;
    last30DaysHours: number | null;
    activeProjectCount: number;
    overCommittedBy: number;
  }>;
  trends: {
    weeklyHours: Array<{ weekOf: string; hours: number }>;
    weeklyRag: Array<{ weekOf: string; red: number; amber: number; green: number }>;
  };
}

interface LatestRiskRow {
  project_id: string;
  week_of: Date;
  rag_level: RagLevel;
}

interface PhaseTransitionRow {
  project_id: string;
  at: Date;
}

/**
 * Single-shot aggregation that backs the Insights page AND the chat endpoint's
 * `getInsightsOverview` tool. Joins existing tables — no new DB structures.
 *
 * At PortX scale (~200 projects, ~64 people, ~30 customers) this completes in
 * well under 200ms with a handful of round trips. React Query's refetch-on-focus
 * provides sufficient freshness; no server-side cache layer in v1.
 */
export async function buildInsightsOverview(db: DB): Promise<InsightsOverview> {
  const now = new Date();
  const todayUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const currentMonday = isoWeekMondayUTC(now);
  const prevMonday = new Date(currentMonday.getTime() - WEEK_MS);
  const launchEnd = new Date(todayUtc.getTime() + LAUNCH_WINDOW_DAYS * DAY_MS);

  // Trend window: the 8 Mondays ending with currentMonday (oldest first).
  const trendMondays: Date[] = [];
  for (let i = TREND_WEEKS - 1; i >= 0; i--) {
    trendMondays.push(new Date(currentMonday.getTime() - i * WEEK_MS));
  }
  // Length is fixed at TREND_WEEKS above; the non-null assertion is safe.
  const trendStart = trendMondays[0]!;
  const trendStartMs = trendStart.getTime();

  // The 30-day cutoff for org-wide last-30-day hours.
  const cutoff30 = todayUtc.getTime() - 29 * DAY_MS;
  const cutoff7 = todayUtc.getTime() - 6 * DAY_MS;

  const [projects, people, capacities, customers, harvestProjects, riskUpdates, phaseTransitions] =
    await Promise.all([
      db.project.findMany({ include: { customer: true } }),
      db.person.findMany({ orderBy: { name: 'asc' } }),
      db.personProjectCapacity.findMany({
        where: { project: { state: { not: 'Done' } } },
      }),
      db.customer.findMany(),
      db.harvestProject.findMany({
        select: {
          id: true,
          projectId: true,
          customerId: true,
          budgetHours: true,
          spentHoursBillable: true,
          spentHoursNonbillable: true,
          raw: true,
        },
      }),
      db.$queryRaw<LatestRiskRow[]>`
        SELECT project_id, week_of, rag_level
        FROM project_risk_updates
        ORDER BY project_id, week_of DESC
      `,
      db.$queryRaw<PhaseTransitionRow[]>`
        SELECT DISTINCT ON (project_id) project_id, at
        FROM phase_audit_log
        ORDER BY project_id, at DESC
      `,
    ]);

  // Risk updates grouped by project, newest first (Postgres ORDER BY above).
  const updatesByProject = new Map<string, LatestRiskRow[]>();
  for (const row of riskUpdates) {
    const list = updatesByProject.get(row.project_id);
    if (list) list.push(row);
    else updatesByProject.set(row.project_id, [row]);
  }

  const latestPhaseAt = new Map<string, Date>();
  for (const row of phaseTransitions) latestPhaseAt.set(row.project_id, row.at);

  // Per-project Harvest aggregates (pinned only — customer-only HarvestProjects
  // don't roll into a project's budget/spent/30d numbers).
  interface ProjectHarvestAgg {
    budget: number | null; // null when no pinned row has a budget
    spent: number; // billable + non-billable across pinned rows
    last30d: number; // org-wide style: ALL hours logged on pinned Harvest projects, all users
  }
  const projHarvest = new Map<string, ProjectHarvestAgg>();
  let orgHours7d = 0;
  let orgHours30d = 0;

  // Weekly hours bucket — keyed by ISO week Monday ms.
  const weeklyHoursMap = new Map<number, number>();
  for (const m of trendMondays) weeklyHoursMap.set(m.getTime(), 0);

  for (const hp of harvestProjects) {
    // Budget / spent aggregation into the project's bucket.
    if (hp.projectId) {
      const existing = projHarvest.get(hp.projectId) ?? { budget: null, spent: 0, last30d: 0 };
      const budget = hp.budgetHours === null ? null : Number(hp.budgetHours);
      if (budget !== null && !Number.isNaN(budget)) {
        existing.budget = (existing.budget ?? 0) + budget;
      }
      existing.spent +=
        Number(hp.spentHoursBillable) + Number(hp.spentHoursNonbillable);
      projHarvest.set(hp.projectId, existing);
    }

    // Walk timeEntries once for org-wide windows, per-project 30d, and weekly buckets.
    const raw = hp.raw as {
      timeEntries?: Array<{ spent_date?: string; hours?: number }>;
    } | null;
    const entries = raw?.timeEntries ?? [];
    for (const e of entries) {
      if (!e.spent_date) continue;
      const t = new Date(`${e.spent_date}T00:00:00Z`).getTime();
      if (!Number.isFinite(t)) continue;
      const hours = e.hours ?? 0;
      if (hours <= 0) continue;

      if (t >= cutoff30) {
        orgHours30d += hours;
        if (hp.projectId) {
          const ex = projHarvest.get(hp.projectId);
          if (ex) ex.last30d += hours;
        }
        if (t >= cutoff7) orgHours7d += hours;
      }

      if (t >= trendStartMs) {
        const wkMonday = isoWeekMondayUTC(new Date(t)).getTime();
        if (weeklyHoursMap.has(wkMonday)) {
          weeklyHoursMap.set(wkMonday, (weeklyHoursMap.get(wkMonday) ?? 0) + hours);
        }
      }
    }
  }

  // Weekly RAG distribution — one query over the 8-week window.
  interface WeeklyRagRow {
    week_of: Date;
    rag_level: RagLevel;
    count: bigint;
  }
  const weeklyRagRows = await db.$queryRaw<WeeklyRagRow[]>`
    SELECT week_of, rag_level, COUNT(*) AS count
    FROM project_risk_updates
    WHERE week_of >= ${trendStart}
    GROUP BY week_of, rag_level
  `;
  const weeklyRagMap = new Map<number, { red: number; amber: number; green: number }>();
  for (const m of trendMondays) {
    weeklyRagMap.set(m.getTime(), { red: 0, amber: 0, green: 0 });
  }
  for (const row of weeklyRagRows) {
    const key = row.week_of.getTime();
    const bucket = weeklyRagMap.get(key);
    if (!bucket) continue;
    const n = Number(row.count);
    if (row.rag_level === 'Red') bucket.red += n;
    else if (row.rag_level === 'Amber') bucket.amber += n;
    else if (row.rag_level === 'Green') bucket.green += n;
  }

  // Active projects, at-risk count, recovered count, etc.
  const activeProjects = projects.filter((p) => p.state !== 'Done');
  let atRiskCount = 0;
  let recoveredThisWeek = 0;
  let overBudgetCount = 0;
  let launchingSoonCount = 0;

  for (const p of activeProjects) {
    const history = updatesByProject.get(p.id) ?? [];
    const latest = history[0] ?? null;
    const prev = history[1] ?? null;
    if (latest && latest.rag_level !== 'Green') atRiskCount++;
    if (
      latest &&
      latest.rag_level === 'Green' &&
      latest.week_of.getTime() === currentMonday.getTime() &&
      prev &&
      prev.week_of.getTime() === prevMonday.getTime() &&
      prev.rag_level !== 'Green'
    ) {
      recoveredThisWeek++;
    }

    const agg = projHarvest.get(p.id);
    if (
      agg &&
      agg.budget !== null &&
      agg.budget > 0 &&
      agg.spent > agg.budget
    ) {
      overBudgetCount++;
    }

    const target = parseIsoDate((p.keyDates as KeyDates).target_go_live);
    if (target && target >= todayUtc && target <= launchEnd) {
      launchingSoonCount++;
    }
  }

  // Active customers = customers with at least one non-Done project.
  const activeCustomerIds = new Set<string>();
  for (const p of activeProjects) {
    if (p.customerId) activeCustomerIds.add(p.customerId);
  }

  // Build the per-project rows.
  const projectRows: InsightsOverview['projects'] = activeProjects.map((p) => {
    const history = updatesByProject.get(p.id) ?? [];
    const latest = history[0] ?? null;
    let weeksStuckAtLevel = 0;
    if (latest && latest.rag_level !== 'Green') {
      // Streak of consecutive most-recent updates at this RAG level.
      for (const row of history) {
        if (row.rag_level === latest.rag_level) weeksStuckAtLevel++;
        else break;
      }
    }
    const phaseAt = latestPhaseAt.get(p.id);
    const daysInCurrentPhase = phaseAt ? daysBetween(phaseAt, todayUtc) : null;

    const agg = projHarvest.get(p.id);
    const budgetHours = agg?.budget ?? null;
    const spentHours = agg ? Number(agg.spent.toFixed(2)) : null;
    const pctOfBudget =
      budgetHours !== null && budgetHours > 0 && spentHours !== null
        ? Number(((spentHours / budgetHours) * 100).toFixed(1))
        : null;

    const baseline = parseIsoDate((p.keyDates as KeyDates).baseline_go_live);
    const target = parseIsoDate((p.keyDates as KeyDates).target_go_live);
    const slipDays = baseline && target ? daysBetween(baseline, target) : null;

    return {
      projectId: p.id,
      projectName: p.name,
      customerId: p.customerId,
      customerName: p.customer?.name ?? null,
      phase: p.phase,
      state: p.state,
      projectType: deriveProjectType((p.details ?? {}) as Record<string, unknown>),
      latestRagLevel: latest?.rag_level ?? null,
      weeksStuckAtLevel,
      daysInCurrentPhase,
      budgetHours,
      spentHours,
      pctOfBudget,
      slipDays,
      last30DaysHours: Number((agg?.last30d ?? 0).toFixed(2)),
    };
  });

  // Per-user rows — only Persons with a Harvest link (so we have real activity).
  // committedPct comes from PersonProjectCapacity (sum across active projects).
  // activeProjectCount uses the same union the /people/overview surface does:
  // role-based assignments (FK + multi-person secondaries) ∪ capacity rows
  // (allocations folded in too via the role/PM/SA/SC FKs and active allocation
  // semantics — but for v1 we use role-FK + capacity ∪ multi-person to stay
  // consistent with how /people surfaces "currently working on").
  const harvestLinkedPeople = people.filter((p) => p.harvestUserId !== null);

  // Pre-index capacities by personId.
  const capByPerson = new Map<string, typeof capacities>();
  for (const c of capacities) {
    const list = capByPerson.get(c.personId);
    if (list) list.push(c);
    else capByPerson.set(c.personId, [c]);
  }

  const peopleNameIndex = buildPeopleNameIndex(people);
  const secondariesByProject = new Map<string, ReturnType<typeof secondariesForProject>>();
  for (const p of activeProjects) {
    const d = (p.details ?? {}) as {
      project_manager?: string;
      solution_architect?: string;
      solution_consultant?: string;
    };
    secondariesByProject.set(
      p.id,
      secondariesForProject(
        d,
        {
          projectManagerId: p.projectManagerId,
          solutionArchitectId: p.solutionArchitectId,
          solutionConsultantId: p.solutionConsultantId,
        },
        peopleNameIndex,
      ),
    );
  }

  // Per-person Harvest 7d totals — we already aggregated org-wide; for 7d
  // per-person we walk the timeEntries again here, but only for Harvest-linked
  // people to keep this cheap.
  interface PersonHarvestTotals {
    last7DaysHours: number;
    last30DaysHours: number;
  }
  const personTotals = new Map<string, PersonHarvestTotals>();
  for (const hp of harvestProjects) {
    const raw = hp.raw as {
      timeEntries?: Array<{
        spent_date?: string;
        hours?: number;
        user?: { id?: number | string };
      }>;
    } | null;
    const entries = raw?.timeEntries ?? [];
    for (const e of entries) {
      if (!e.spent_date) continue;
      const userId = String(e.user?.id ?? '');
      if (!userId) continue;
      const t = new Date(`${e.spent_date}T00:00:00Z`).getTime();
      if (!Number.isFinite(t) || t < cutoff30) continue;
      const hours = e.hours ?? 0;
      if (hours <= 0) continue;
      const existing = personTotals.get(userId) ?? {
        last7DaysHours: 0,
        last30DaysHours: 0,
      };
      existing.last30DaysHours += hours;
      if (t >= cutoff7) existing.last7DaysHours += hours;
      personTotals.set(userId, existing);
    }
  }

  const peopleRows: InsightsOverview['people'] = harvestLinkedPeople.map((person) => {
    const myCaps = capByPerson.get(person.id) ?? [];
    const committedPct = myCaps.reduce((sum, c) => sum + c.weeklyPct, 0);

    const activeProjectIds = new Set<string>();
    for (const c of myCaps) activeProjectIds.add(c.projectId);
    for (const p of activeProjects) {
      const fkMatch =
        p.ownerId === person.id ||
        p.projectManagerId === person.id ||
        p.solutionArchitectId === person.id ||
        p.solutionConsultantId === person.id;
      const secondaries = secondariesByProject.get(p.id);
      const secondaryMatch =
        !!secondaries &&
        (secondaries.projectManager.some((r) => r.id === person.id) ||
          secondaries.solutionArchitect.some((r) => r.id === person.id) ||
          secondaries.solutionConsultant.some((r) => r.id === person.id));
      if (fkMatch || secondaryMatch) activeProjectIds.add(p.id);
    }

    const totals = person.harvestUserId
      ? personTotals.get(person.harvestUserId)
      : undefined;

    return {
      personId: person.id,
      name: person.name,
      email: person.email,
      role: person.role,
      isAdmin: person.isAdmin,
      harvestUserId: person.harvestUserId,
      defaultCapacityPct: person.defaultCapacityPct,
      availabilityPct: person.availabilityPct,
      committedPct,
      last7DaysHours:
        totals === undefined ? null : Number(totals.last7DaysHours.toFixed(2)),
      last30DaysHours:
        totals === undefined ? null : Number(totals.last30DaysHours.toFixed(2)),
      activeProjectCount: activeProjectIds.size,
      overCommittedBy: Math.max(
        0,
        committedPct + person.availabilityPct - person.defaultCapacityPct,
      ),
    };
  });

  // Trend arrays — oldest first.
  const weeklyHours: InsightsOverview['trends']['weeklyHours'] = trendMondays.map((m) => ({
    weekOf: toIsoDateUTC(m),
    hours: Number((weeklyHoursMap.get(m.getTime()) ?? 0).toFixed(2)),
  }));
  const weeklyRag: InsightsOverview['trends']['weeklyRag'] = trendMondays.map((m) => {
    const bucket = weeklyRagMap.get(m.getTime()) ?? { red: 0, amber: 0, green: 0 };
    return { weekOf: toIsoDateUTC(m), red: bucket.red, amber: bucket.amber, green: bucket.green };
  });

  void customers; // currently unused outside activeCustomerIds counting

  return {
    asOf: now.toISOString(),
    kpis: {
      activeProjects: activeProjects.length,
      atRisk: atRiskCount,
      recoveredThisWeek,
      overBudget: overBudgetCount,
      launchingSoon: launchingSoonCount,
      hours7d: Number(orgHours7d.toFixed(2)),
      hours30d: Number(orgHours30d.toFixed(2)),
      activeCustomers: activeCustomerIds.size,
    },
    projects: projectRows,
    people: peopleRows,
    trends: { weeklyHours, weeklyRag },
  };
}
