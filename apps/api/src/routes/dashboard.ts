import type { FastifyInstance } from 'fastify';
import type { Phase, ProjectState, RagLevel } from '@prisma/client';
import type { DB } from '../db.js';
import { requireUser } from '../plugins/guards.js';
import { isoWeekMondayUTC, toIsoDateUTC } from '../lib/iso-week.js';

interface RegisterDashboardOptions {
  db: DB;
}

interface KeyDatesShape {
  baseline_go_live?: string;
  target_go_live?: string;
  actual_go_live?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const SCHEDULE_PRESSURE_LIMIT = 30;
const SLIPPING_LIMIT = 30;
const LAUNCH_WINDOW_DAYS = 30;

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

function parseIso(date: string | undefined): Date | null {
  if (!date) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

interface LatestRiskRow {
  project_id: string;
  week_of: Date;
  rag_level: RagLevel;
}

interface WeekRagRow {
  project_id: string;
  rag_level: RagLevel;
}

const ALL_PHASES: Phase[] = [
  'Backlog',
  'Initiation',
  'Design',
  'Development',
  'UAT',
  'GoLiveReadiness',
  'Production',
];

export function registerDashboardRoutes(
  app: FastifyInstance,
  opts: RegisterDashboardOptions,
): void {
  const { db } = opts;

  app.get('/api/dashboard/summary', async (request) => {
    requireUser(request);

    const now = new Date();
    const todayUtc = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const thisWeekMonday = isoWeekMondayUTC(now);
    const prevWeekMonday = new Date(thisWeekMonday.getTime() - 7 * DAY_MS);
    const launchEnd = new Date(todayUtc.getTime() + LAUNCH_WINDOW_DAYS * DAY_MS);

    const projects = await db.project.findMany({
      include: { harvestSnapshot: true },
    });

    const latestRags = await db.$queryRaw<LatestRiskRow[]>`
      SELECT DISTINCT ON (project_id) project_id, week_of, rag_level
      FROM project_risk_updates
      ORDER BY project_id, week_of DESC
    `;
    const latestByProject = new Map<string, LatestRiskRow>();
    for (const row of latestRags) latestByProject.set(row.project_id, row);

    const thisWeekRows = await db.$queryRaw<WeekRagRow[]>`
      SELECT project_id, rag_level FROM project_risk_updates WHERE week_of = ${thisWeekMonday}
    `;
    const prevWeekRows = await db.$queryRaw<WeekRagRow[]>`
      SELECT project_id, rag_level FROM project_risk_updates WHERE week_of = ${prevWeekMonday}
    `;
    function countByLevel(rows: WeekRagRow[]): { Red: number; Amber: number; Green: number } {
      const c = { Red: 0, Amber: 0, Green: 0 };
      for (const r of rows) c[r.rag_level]++;
      return c;
    }
    const thisWeekCounts = countByLevel(thisWeekRows);
    const prevWeekCounts = countByLevel(prevWeekRows);
    const haveCurrentUpdate = new Set(thisWeekRows.map((r) => r.project_id));

    const isActive = (state: ProjectState) => state !== 'Done';
    const active = projects.filter((p) => isActive(p.state));

    let overBudgetCount = 0;
    for (const p of active) {
      const snap = p.harvestSnapshot;
      if (!snap) continue;
      const budget = snap.budgetHours === null ? null : Number(snap.budgetHours);
      if (budget === null || budget <= 0) continue;
      const spent = Number(snap.spentHoursBillable) + Number(snap.spentHoursNonbillable);
      if (spent > budget) overBudgetCount++;
    }

    let launchingSoonCount = 0;
    for (const p of active) {
      const tgl = parseIso((p.keyDates as KeyDatesShape).target_go_live);
      if (!tgl) continue;
      if (tgl >= todayUtc && tgl <= launchEnd) launchingSoonCount++;
    }

    let slipSum = 0;
    let slipCount = 0;
    for (const p of projects) {
      if (p.state !== 'Done') continue;
      const baseline = parseIso((p.keyDates as KeyDatesShape).baseline_go_live);
      const actual = parseIso((p.keyDates as KeyDatesShape).actual_go_live);
      if (!baseline || !actual) continue;
      slipSum += daysBetween(baseline, actual);
      slipCount++;
    }
    const avgSlipDays = slipCount > 0 ? slipSum / slipCount : null;

    let atRiskCount = 0;
    for (const p of active) {
      const latest = latestByProject.get(p.id);
      if (latest && latest.rag_level !== 'Green') atRiskCount++;
    }

    const peopleSet = new Set<string>();
    for (const p of active) {
      if (p.projectManagerId) peopleSet.add(p.projectManagerId);
      if (p.solutionArchitectId) peopleSet.add(p.solutionArchitectId);
      if (p.solutionConsultantId) peopleSet.add(p.solutionConsultantId);
    }

    interface SchedRow {
      projectId: string;
      projectName: string;
      targetGoLive: string;
      daysUntil: number;
      phase: Phase;
      ragLevel: RagLevel | null;
      overBudget: boolean;
    }
    const schedulePressure: SchedRow[] = [];
    for (const p of active) {
      const tgl = parseIso((p.keyDates as KeyDatesShape).target_go_live);
      if (!tgl) continue;
      if (tgl < todayUtc || tgl > launchEnd) continue;
      const latest = latestByProject.get(p.id);
      const rag: RagLevel | null =
        latest && latest.rag_level !== 'Green' ? latest.rag_level : null;
      const snap = p.harvestSnapshot;
      let overBudget = false;
      if (snap) {
        const budget = snap.budgetHours === null ? null : Number(snap.budgetHours);
        if (budget !== null && budget > 0) {
          const spent = Number(snap.spentHoursBillable) + Number(snap.spentHoursNonbillable);
          if (spent > budget) overBudget = true;
        }
      }
      schedulePressure.push({
        projectId: p.id,
        projectName: p.name,
        targetGoLive: toIsoDateUTC(tgl),
        daysUntil: daysBetween(todayUtc, tgl),
        phase: p.phase,
        ragLevel: rag,
        overBudget,
      });
    }
    schedulePressure.sort((a, b) => a.targetGoLive.localeCompare(b.targetGoLive));
    const schedulePressureTop = schedulePressure.slice(0, SCHEDULE_PRESSURE_LIMIT);

    interface NoUpdateRow {
      projectId: string;
      projectName: string;
      latestRagLevel: RagLevel | null;
      weeksSinceLastUpdate: number | null;
    }
    const noRiskUpdate: NoUpdateRow[] = [];
    for (const p of active) {
      if (haveCurrentUpdate.has(p.id)) continue;
      const latest = latestByProject.get(p.id);
      const weeksSince =
        latest === undefined
          ? null
          : Math.round((thisWeekMonday.getTime() - latest.week_of.getTime()) / (7 * DAY_MS));
      noRiskUpdate.push({
        projectId: p.id,
        projectName: p.name,
        latestRagLevel: latest?.rag_level ?? null,
        weeksSinceLastUpdate: weeksSince,
      });
    }
    const ragPriority = (r: RagLevel | null): number =>
      r === 'Red' ? 0 : r === 'Amber' ? 1 : r === null ? 2 : 3;
    noRiskUpdate.sort((a, b) => {
      const pa = ragPriority(a.latestRagLevel);
      const pb = ragPriority(b.latestRagLevel);
      if (pa !== pb) return pa - pb;
      const wa = a.weeksSinceLastUpdate ?? -1;
      const wb = b.weeksSinceLastUpdate ?? -1;
      return wb - wa;
    });

    interface SlipRow {
      projectId: string;
      projectName: string;
      baselineGoLive: string;
      targetGoLive: string;
      slipDays: number;
    }
    const slipping: SlipRow[] = [];
    for (const p of active) {
      const baseline = parseIso((p.keyDates as KeyDatesShape).baseline_go_live);
      const target = parseIso((p.keyDates as KeyDatesShape).target_go_live);
      if (!baseline || !target) continue;
      if (target <= baseline) continue;
      slipping.push({
        projectId: p.id,
        projectName: p.name,
        baselineGoLive: toIsoDateUTC(baseline),
        targetGoLive: toIsoDateUTC(target),
        slipDays: daysBetween(baseline, target),
      });
    }
    slipping.sort((a, b) => b.slipDays - a.slipDays);
    const slippingTop = slipping.slice(0, SLIPPING_LIMIT);

    const phaseCounts: Record<Phase, number> = Object.fromEntries(
      ALL_PHASES.map((ph) => [ph, 0]),
    ) as Record<Phase, number>;
    for (const p of active) phaseCounts[p.phase]++;

    return {
      kpis: {
        active: active.length,
        atRisk: atRiskCount,
        overBudget: overBudgetCount,
        launchingSoon: launchingSoonCount,
        avgSlipDays,
        peopleInvolved: peopleSet.size,
      },
      thisWeekRag: {
        red: thisWeekCounts.Red,
        amber: thisWeekCounts.Amber,
        green: thisWeekCounts.Green,
        prevRed: prevWeekCounts.Red,
        prevAmber: prevWeekCounts.Amber,
        prevGreen: prevWeekCounts.Green,
      },
      schedulePressure: schedulePressureTop,
      noRiskUpdate,
      slipping: slippingTop,
      phaseCounts,
    };
  });
}
