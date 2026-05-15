import { z } from 'zod';
import {
  PhaseSchema,
  ProjectStateSchema,
  RoleSchema,
  TrackerProviderSchema,
} from './enums.js';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const KeyDatesSchema = z
  .object({
    kickoff: isoDate.optional(),
    target_go_live: isoDate.optional(),
    actual_go_live: isoDate.optional(),
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
  });

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
  ownerId: z.string().nullable(),
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
  ownerId: z.string().optional().nullable(),
});

export const ProjectUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    phase: PhaseSchema.optional(),
    state: ProjectStateSchema.optional(),
    keyDates: KeyDatesSchema.optional(),
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

export type KeyDates = z.infer<typeof KeyDatesSchema>;
export type TrackerRef = z.infer<typeof TrackerRefSchema>;
export type FieldMapping = z.infer<typeof FieldMappingSchema>;
export type ProjectOut = z.infer<typeof ProjectOutSchema>;
export type ProjectCreate = z.infer<typeof ProjectCreateSchema>;
export type ProjectUpdate = z.infer<typeof ProjectUpdateSchema>;
export type AllocationOut = z.infer<typeof AllocationOutSchema>;
export type AllocationCreate = z.infer<typeof AllocationCreateSchema>;
export type AllocationUpdate = z.infer<typeof AllocationUpdateSchema>;
export type PersonOut = z.infer<typeof PersonOutSchema>;
