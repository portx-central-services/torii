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

/** Lightweight resolved Customer row exposed alongside Project responses. */
export const CustomerRefSchema = z.object({
  id: z.string(),
  name: z.string(),
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
  /** Customer this project belongs to. Null when the project has not been mapped to a customer yet. */
  customerId: z.string().nullable(),
  /** Resolved customer row (id + name). Null when `customerId` is null. */
  customer: CustomerRefSchema.nullable(),
  /**
   * Derived from the customer's pinned `HarvestProject` rows: `Σ spent_hours > Σ budget_hours`.
   * Sums across every `harvest_projects` row with `project_id = this project`. False when
   * no Harvest project is pinned, when every pinned row has a null `budget_hours`, or when
   * the total budget is zero. Read-only on the API.
   */
  overBudget: z.boolean(),
  /** Sum of budget hours across pinned Harvest projects. Null when no pinned row has a budget. */
  budgetHours: z.number().nullable(),
  /** Sum of (billable + non-billable) spent hours across pinned Harvest projects. Null when no pinned rows. */
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
 * Snapshot of a single Harvest project's hours data, cached on the Torii side as a
 * `harvest_projects` row. Hours-only by design (D9). The full Harvest API payload
 * is stored separately on `harvest_projects.raw` for debugging and is never surfaced
 * through this schema.
 *
 * The `.strict()` is load-bearing: it actively rejects any payload that smuggles
 * monetary keys (e.g., `costCents`) through this surface — defense-in-depth for D9.
 */
export const HarvestProjectSnapshotSchema = z
  .object({
    /** The Harvest project's own numeric ID, stored as text. */
    id: z.string(),
    name: z.string(),
    /** Customer this Harvest project belongs to. */
    customerId: z.string(),
    /** Torii project this Harvest project is pinned to, or null when customer-only (support). */
    projectId: z.string().nullable(),
    isBillable: z.boolean(),
    harvestProjectUrl: z.string(),
    budgetHours: z.number().nullable(),
    spentHoursBillable: z.number().nonnegative(),
    spentHoursNonbillable: z.number().nonnegative(),
    breakdown: z.array(HarvestBreakdownTaskSchema),
    fetchedAt: z.string(),
  })
  .strict();

/** Backwards-compatibility alias for the old `HarvestSnapshotSchema` name. Use `HarvestProjectSnapshotSchema` going forward. */
export const HarvestSnapshotSchema = HarvestProjectSnapshotSchema;

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
export type HarvestProjectSnapshot = z.infer<typeof HarvestProjectSnapshotSchema>;
/** Deprecated alias kept while consumers migrate. */
export type HarvestSnapshot = HarvestProjectSnapshot;
export type CustomerRef = z.infer<typeof CustomerRefSchema>;

/** Row returned by `GET /api/customers` (one entry per Torii customer). */
export const CustomerListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  harvestClientId: z.string().nullable(),
  mondayProjectCount: z.number().int().nonnegative(),
  harvestProjectCount: z.number().int().nonnegative(),
  lifetimeHours: z.number().nonnegative(),
});
export type CustomerListItem = z.infer<typeof CustomerListItemSchema>;

/** Row in the per-customer reconciliation `perProject` array. */
export const CustomerReconciliationProjectRowSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  plannedHours: z.number().nonnegative(),
  actualHours: z.number().nonnegative(),
  varianceHours: z.number(),
  variancePct: z.number().nullable(),
  linkedHarvestProjectIds: z.array(z.string()),
});

/** Response shape for `GET /api/customers/:id/reconciliation`. */
export const CustomerReconciliationSchema = z.object({
  customerId: z.string(),
  customerName: z.string(),
  /** "Planned" = Σ over allocations of (pct × defaultCapacityPct × 40 × weeks). Reads Torii allocations, NOT Harvest budgets. */
  plannedHours: z.number().nonnegative(),
  actualHours: z.number().nonnegative(),
  /** Hours logged on Harvest projects under this customer that are NOT pinned to any Torii project. */
  supportHours: z.number().nonnegative(),
  /** "Budget" = Σ of `harvest_projects.budgetHours` across this customer's rows (Harvest-side commitment). Null when no Harvest project has a budget set. */
  budgetHours: z.number().nonnegative().nullable(),
  /** actualHours - plannedHours. Signed. */
  varianceHours: z.number(),
  /** Null when plannedHours is 0. */
  variancePct: z.number().nullable(),
  /** actualHours - budgetHours. Signed. Null when budgetHours is null. */
  budgetVarianceHours: z.number().nullable(),
  /** Null when budgetHours is null or 0. */
  budgetVariancePct: z.number().nullable(),
  perProject: z.array(CustomerReconciliationProjectRowSchema),
});
export type CustomerReconciliation = z.infer<typeof CustomerReconciliationSchema>;
export type CustomerReconciliationProjectRow = z.infer<typeof CustomerReconciliationProjectRowSchema>;

/** Row returned by `GET /api/people/overview` (one per Person, plus expander data). */
export const PeopleOverviewRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  role: RoleSchema,
  isAdmin: z.boolean(),
  harvestUserId: z.string().nullable(),
  defaultCapacityPct: z.number().int().min(0).max(100),
  availabilityPct: z.number().int().min(0).max(100),
  /** Σ weeklyPct across the person's capacity rows. */
  committedPct: z.number().int().min(0),
  /** Sum of Harvest hours in the trailing 30-day window; null when unlinked or not yet computed. */
  billedHoursLast30d: z.number().nullable(),
  billedHoursAsOf: z.string().nullable(),
  lastReportedAt: z.string().nullable(),
  currentProjects: z.array(
    z.object({
      projectId: z.string(),
      projectName: z.string(),
      projectPhase: PhaseSchema,
      /** Customer this project belongs to. Null when the project isn't mapped to a customer yet. */
      customerId: z.string().nullable(),
      customerName: z.string().nullable(),
      weeklyPct: z.number().int().min(0).max(100),
      allocatedPct: z.number().int().min(0),
      lifetimeHours: z.number().nullable(),
      varianceBucket: z.enum(['green', 'amber', 'red', 'neutral']),
    }),
  ),
});
export type PeopleOverviewRow = z.infer<typeof PeopleOverviewRowSchema>;

/** Row in the per-person workload table on `/people/:id`. */
export const WorkloadRowSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  projectPhase: PhaseSchema,
  projectState: ProjectStateSchema,
  /** Self-reported weekly capacity; 0 when no row exists for that (person, project). */
  weeklyPct: z.number().int().min(0).max(100),
  /** Sum of Allocation.pct for active allocations (today between start and end). */
  allocatedPct: z.number().int().min(0),
  /** Sum of Harvest hours for this person on this project. Null when person isn't Harvest-linked. */
  lifetimeHours: z.number().nullable(),
  varianceBucket: z.enum(['green', 'amber', 'red', 'neutral']),
});
export type WorkloadRow = z.infer<typeof WorkloadRowSchema>;

/** Response shape for `GET /api/people/:id/workload`. */
export const WorkloadResponseSchema = z.object({
  availabilityPct: z.number().int().min(0).max(100),
  defaultCapacityPct: z.number().int().min(0).max(100),
  /** ISO timestamp of the most recent capacity-row update; null when no rows exist. */
  lastReportedAt: z.string().nullable(),
  projects: z.array(WorkloadRowSchema),
});
export type WorkloadResponse = z.infer<typeof WorkloadResponseSchema>;

/** Body schema for `PATCH /api/people/:id/workload`. */
export const WorkloadUpdateSchema = z.object({
  availabilityPct: z.number().int().min(0).max(100).optional(),
  projects: z
    .array(
      z.object({
        projectId: z.string().min(1),
        weeklyPct: z.number().int().min(0).max(100),
      }),
    )
    .optional(),
});
export type WorkloadUpdate = z.infer<typeof WorkloadUpdateSchema>;

/** Row returned by `GET /api/tracker/harvest/clients` (one entry per active Harvest client). */
export const HarvestClientListItemSchema = z.object({
  harvestClientId: z.string(),
  name: z.string(),
  linkedToiriCustomerId: z.string().nullable(),
  linkedToiriCustomerName: z.string().nullable(),
});
export type HarvestClientListItem = z.infer<typeof HarvestClientListItemSchema>;

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
