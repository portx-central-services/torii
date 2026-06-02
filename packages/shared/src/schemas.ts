import { z } from 'zod';
import {
  PhaseSchema,
  ProjectStateSchema,
  ProjectTypeSchema,
  RagLevelSchema,
  RiskStateSchema,
  RiskTypeSchema,
  RoleSchema,
  TrackerProviderSchema,
} from './enums.js';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const KeyDatesSchema = z
  .object({
    /** Project kickoff — formal PMO intake. Maps to Monday "Project Add Date". The Timeline bar's left edge. */
    kickoff: isoDate.optional(),
    /** Start of active delivery work (post-intake). Maps to Monday "Project Start Date". Renders as a tick on the Timeline bar. */
    project_start: isoDate.optional(),
    /** Start of the UAT phase. Maps to Monday "UAT Start Date". */
    uat_start: isoDate.optional(),
    /** Original committed go-live (Monday "Baseline Go-live"). Informational only — Gantt uses `target_go_live`. */
    baseline_go_live: isoDate.optional(),
    /** Current realistic go-live; can shift over time. Maps to Monday "Expected Go-Live Date". The canonical target. */
    target_go_live: isoDate.optional(),
    /** When the project actually went live. Used to compare against `baseline_go_live`. Maps to Monday "Actual Go-Live Date". */
    actual_go_live: isoDate.optional(),
    /** End of hypercare. Torii-owned; no Monday source — derived from `actual_go_live`/`target_go_live` when not set. */
    hypercare_end: isoDate.optional(),
  })
  .superRefine((d, ctx) => {
    if (d.kickoff && d.target_go_live && d.target_go_live < d.kickoff) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['target_go_live'],
        message: 'target_go_live must be on or after kickoff',
      });
    }
    if (d.kickoff && d.actual_go_live && d.actual_go_live < d.kickoff) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['actual_go_live'],
        message: 'actual_go_live must not precede kickoff',
      });
    }
    if (d.kickoff && d.project_start && d.project_start < d.kickoff) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['project_start'],
        message: 'project_start must not precede kickoff',
      });
    }
  });

/** Fixed set of free-form project detail fields surfaced in the list/detail UIs. */
export const PROJECT_DETAIL_KEYS = [
  'project_manager',
  'solution_architect',
  'solution_consultant',
  'core_solution',
  'core_vendor',
  'primary_contact',
  'status_report_url',
  'jira_project_url',
  'customer_type',
  'finance_use_case',
  'use_case_group',
  'customer_status',
] as const;

export type ProjectDetailKey = (typeof PROJECT_DETAIL_KEYS)[number];

/** Detail keys whose values are URLs (rendered as links, URL-validated on write). */
export const PROJECT_DETAIL_URL_KEYS = ['status_report_url', 'jira_project_url'] as const;

const detailText = z.string().optional();
// Allow empty string (cleared field) or a valid URL.
const detailUrl = z.union([z.literal(''), z.string().url()]).optional();

export const ProjectDetailsSchema = z
  .object({
    project_manager: detailText,
    solution_architect: detailText,
    solution_consultant: detailText,
    core_solution: detailText,
    core_vendor: detailText,
    primary_contact: detailText,
    status_report_url: detailUrl,
    jira_project_url: detailUrl,
    customer_type: detailText,
    finance_use_case: detailText,
    use_case_group: detailText,
    customer_status: detailText,
  })
  .strict();

export const TrackerRefSchema = z
  .object({
    provider: TrackerProviderSchema,
    externalId: z.string().min(1),
  })
  .nullable();

export const FieldOwnerSchema = z.enum(['torii', 'monday']);
export const FieldMappingSchema = z.record(FieldOwnerSchema);

export const PersonOutSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  role: RoleSchema,
  defaultCapacityPct: z.number().int().min(0).max(100),
  isAdmin: z.boolean(),
});

export const ProjectOutSchema = z.object({
  id: z.string(),
  name: z.string(),
  phase: PhaseSchema,
  state: ProjectStateSchema,
  keyDates: KeyDatesSchema,
  details: ProjectDetailsSchema.optional(),
  /** Derived from `details.fintech_parent` server-side; not a persisted column. */
  projectType: ProjectTypeSchema,
  /** Numeric Harvest project ID when the project is linked; null otherwise. */
  harvestProjectId: z.string().nullable(),
  /**
   * Derived from the cached Harvest snapshot: `spent_hours > budget_hours` (strict).
   * False when there's no snapshot, no link, or `budget_hours` is null/0. Read-only
   * on the API — `projects` has no `over_budget` column.
   */
  overBudget: z.boolean(),
  /** Budget hours from the cached snapshot. Null when no snapshot or no budget set. */
  budgetHours: z.number().nullable(),
  /** Total spent hours (billable + non-billable). Null when no snapshot. */
  spentHours: z.number().nullable(),
  ownerId: z.string().nullable(),
  /**
   * Resolved Person rows for the three role FKs. Null when the FK is unset.
   * UI consumers prefer `Person.name` and fall back to the legacy `details.*`
   * string when the Person is null. Not writable on POST/PATCH.
   */
  projectManager: PersonOutSchema.nullable(),
  solutionArchitect: PersonOutSchema.nullable(),
  solutionConsultant: PersonOutSchema.nullable(),
  trackerRef: TrackerRefSchema,
  fieldMapping: FieldMappingSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ProjectCreateSchema = z.object({
  name: z.string().min(1),
  phase: PhaseSchema.optional(),
  state: ProjectStateSchema.optional(),
  keyDates: KeyDatesSchema.optional(),
  details: ProjectDetailsSchema.optional(),
  ownerId: z.string().optional().nullable(),
});

export const ProjectUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    phase: PhaseSchema.optional(),
    state: ProjectStateSchema.optional(),
    keyDates: KeyDatesSchema.optional(),
    details: ProjectDetailsSchema.optional(),
    ownerId: z.string().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'No fields to update',
  });

export const ProjectListFilterSchema = z.object({
  phase: PhaseSchema.optional(),
  state: ProjectStateSchema.optional(),
  owner: z.string().optional(),
  sort: z.enum(['name', 'name:desc', 'target_go_live', 'target_go_live:desc']).optional(),
});

export const AllocationOutSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  personId: z.string(),
  pct: z.number().int().min(0).max(100),
  start: isoDate,
  end: isoDate,
});

export const AllocationCreateSchema = z
  .object({
    projectId: z.string().min(1),
    personId: z.string().min(1),
    pct: z.number().int().min(0).max(100),
    start: isoDate,
    end: isoDate,
  })
  .refine((v) => v.end >= v.start, {
    path: ['end'],
    message: 'end must be on or after start',
  });

export const AllocationUpdateSchema = z
  .object({
    pct: z.number().int().min(0).max(100).optional(),
    start: isoDate.optional(),
    end: isoDate.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'No fields to update',
  });

/** Weekly risk snapshot per project. `weekOf` is the Monday of an ISO week (UTC), as YYYY-MM-DD. */
export const ProjectRiskUpdateOutSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  weekOf: isoDate,
  ragLevel: RagLevelSchema,
  riskTypes: z.array(RiskTypeSchema).min(1),
  state: RiskStateSchema,
  description: z.string(),
  goToGreenPlan: z.string(),
  latestUpdate: z.string(),
  nextSteps: z.string(),
  actionRequested: z.string(),
  authorId: z.string(),
  authorName: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** Body schema for `POST /api/projects/:id/risk-updates`. `weekOf` is optional — when present it MUST equal the current ISO week's Monday (UTC); the server enforces this. */
export const ProjectRiskUpdateUpsertSchema = z.object({
  weekOf: isoDate.optional(),
  ragLevel: RagLevelSchema,
  riskTypes: z.array(RiskTypeSchema).min(1, 'At least one risk type is required'),
  state: RiskStateSchema,
  description: z.string().default(''),
  goToGreenPlan: z.string().default(''),
  latestUpdate: z.string().default(''),
  nextSteps: z.string().default(''),
  actionRequested: z.string().default(''),
});

/** Row shape returned by `GET /api/risks` (one entry per currently-at-risk project). */
export const RiskListItemSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  weekOf: isoDate,
  ragLevel: RagLevelSchema,
  riskTypes: z.array(RiskTypeSchema),
  state: RiskStateSchema,
  title: z.string(),
});

/**
 * Per-(task, person) row in a Harvest snapshot. Hours-only by design.
 *
 * The `.strict()` is load-bearing: it actively rejects any payload that smuggles
 * monetary keys (e.g., `costCents`) through this surface — defense-in-depth for D9.
 */
export const HarvestBreakdownPersonSchema = z
  .object({
    personId: z.string(),
    personName: z.string(),
    hours: z.number().nonnegative(),
    archived: z.boolean().optional(),
  })
  .strict();

export const HarvestBreakdownTaskSchema = z
  .object({
    taskId: z.string(),
    taskName: z.string(),
    taskBudgetHours: z.number().nullable(),
    taskSpentHours: z.number().nonnegative(),
    people: z.array(HarvestBreakdownPersonSchema),
  })
  .strict();

/**
 * Snapshot of a single Harvest project's hours data, cached on the Torii side.
 *
 * Intentionally omits cost / invoicing fields (D9). The raw Harvest payload is
 * stored separately on `project_harvest_snapshots.raw` for debugging and is never
 * surfaced through this schema.
 */
export const HarvestSnapshotSchema = z
  .object({
    projectId: z.string(),
    fetchedAt: z.string(),
    harvestProjectId: z.string(),
    harvestProjectUrl: z.string(),
    budgetHours: z.number().nullable(),
    spentHoursBillable: z.number().nonnegative(),
    spentHoursNonbillable: z.number().nonnegative(),
    breakdown: z.array(HarvestBreakdownTaskSchema),
  })
  .strict();

export type KeyDates = z.infer<typeof KeyDatesSchema>;
export type ProjectDetails = z.infer<typeof ProjectDetailsSchema>;
export type TrackerRef = z.infer<typeof TrackerRefSchema>;
export type FieldMapping = z.infer<typeof FieldMappingSchema>;
export type ProjectOut = z.infer<typeof ProjectOutSchema>;
export type ProjectCreate = z.infer<typeof ProjectCreateSchema>;
export type ProjectUpdate = z.infer<typeof ProjectUpdateSchema>;
export type AllocationOut = z.infer<typeof AllocationOutSchema>;
export type AllocationCreate = z.infer<typeof AllocationCreateSchema>;
export type AllocationUpdate = z.infer<typeof AllocationUpdateSchema>;
export type PersonOut = z.infer<typeof PersonOutSchema>;
export type ProjectRiskUpdateOut = z.infer<typeof ProjectRiskUpdateOutSchema>;
export type ProjectRiskUpdateUpsert = z.infer<typeof ProjectRiskUpdateUpsertSchema>;
export type RiskListItem = z.infer<typeof RiskListItemSchema>;

/**
 * One row per project on the per-person reconciliation endpoint
 * (`GET /api/people/:id/reconciliation`). `actualHours`/`variance`/`variancePct`
 * are null when the Person isn't linked to a Harvest user yet.
 */
export const PersonReconciliationRowSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  plannedHours: z.number().nonnegative(),
  actualHours: z.number().nullable(),
  /** Signed: actual − planned. Null when actualHours is null. */
  variance: z.number().nullable(),
  /** Signed percentage of planned. Null when actualHours is null or planned is 0. */
  variancePct: z.number().nullable(),
  linkedToHarvest: z.boolean(),
});
export type PersonReconciliationRow = z.infer<typeof PersonReconciliationRowSchema>;
export type HarvestBreakdownPerson = z.infer<typeof HarvestBreakdownPersonSchema>;
export type HarvestBreakdownTask = z.infer<typeof HarvestBreakdownTaskSchema>;
export type HarvestSnapshot = z.infer<typeof HarvestSnapshotSchema>;

/** Response shape for `GET /api/dashboard/summary`. Single bundle covering every dashboard section. */
export const DashboardSummarySchema = z.object({
  kpis: z.object({
    active: z.number().int().nonnegative(),
    atRisk: z.number().int().nonnegative(),
    overBudget: z.number().int().nonnegative(),
    launchingSoon: z.number().int().nonnegative(),
    /** Null when no Done projects have both `baseline_go_live` and `actual_go_live` set. */
    avgSlipDays: z.number().nullable(),
    peopleInvolved: z.number().int().nonnegative(),
  }),
  thisWeekRag: z.object({
    red: z.number().int().nonnegative(),
    amber: z.number().int().nonnegative(),
    green: z.number().int().nonnegative(),
    prevRed: z.number().int().nonnegative(),
    prevAmber: z.number().int().nonnegative(),
    prevGreen: z.number().int().nonnegative(),
  }),
  schedulePressure: z.array(
    z.object({
      projectId: z.string(),
      projectName: z.string(),
      targetGoLive: isoDate,
      daysUntil: z.number().int(),
      phase: PhaseSchema,
      ragLevel: RagLevelSchema.nullable(),
      overBudget: z.boolean(),
    }),
  ),
  noRiskUpdate: z.array(
    z.object({
      projectId: z.string(),
      projectName: z.string(),
      latestRagLevel: RagLevelSchema.nullable(),
      weeksSinceLastUpdate: z.number().int().nullable(),
    }),
  ),
  slipping: z.array(
    z.object({
      projectId: z.string(),
      projectName: z.string(),
      baselineGoLive: isoDate,
      targetGoLive: isoDate,
      slipDays: z.number().int().positive(),
    }),
  ),
  phaseCounts: z.record(PhaseSchema, z.number().int().nonnegative()),
});
export type DashboardSummary = z.infer<typeof DashboardSummarySchema>;
