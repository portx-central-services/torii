import { describe, it, expect, vi } from 'vitest';
import {
  resolvePersonByName,
  resolveProjectRolePeople,
  slugifyForEmail,
} from '../src/sync/resolve-people.js';

/** Minimal in-memory Person + Project store backing a Prisma-shaped mock. */
function makeMockDb() {
  type PersonRow = {
    id: string;
    name: string;
    email: string;
    role: string;
    defaultCapacityPct: number;
    isAdmin: boolean;
  };
  const people: PersonRow[] = [];
  let counter = 0;
  const projectUpdates: Array<{
    where: { id: string };
    data: { projectManagerId: string | null; solutionArchitectId: string | null; solutionConsultantId: string | null };
  }> = [];

  const person = {
    findFirst: vi.fn(async (args: { where: { name: { equals: string; mode: string } } }) => {
      const needle = args.where.name.equals.toLowerCase();
      return people.find((p) => p.name.toLowerCase() === needle) ?? null;
    }),
    findUnique: vi.fn(async (args: { where: { email: string } }) => {
      return people.find((p) => p.email === args.where.email) ?? null;
    }),
    create: vi.fn(async (args: { data: PersonRow & { id?: string }; select?: unknown }) => {
      counter += 1;
      const row = { ...args.data, id: `person-${counter}` };
      people.push(row);
      return row;
    }),
  };

  const project = {
    update: vi.fn(async (args: { where: { id: string }; data: typeof projectUpdates[number]['data'] }) => {
      projectUpdates.push(args);
      return { id: args.where.id };
    }),
  };

  return { person, project, _state: { people, projectUpdates } };
}

describe('slugifyForEmail', () => {
  it('lowercases + replaces non-alnum with single hyphen', () => {
    expect(slugifyForEmail('Aaron Levy')).toBe('aaron-levy');
    expect(slugifyForEmail('Aaron J. Levy')).toBe('aaron-j-levy');
    expect(slugifyForEmail('  Sarah  ')).toBe('sarah');
  });
  it('strips leading/trailing hyphens', () => {
    expect(slugifyForEmail('---Aaron---')).toBe('aaron');
  });
  it('returns "unknown" when input cleans down to empty', () => {
    expect(slugifyForEmail('!!!')).toBe('unknown');
    expect(slugifyForEmail('')).toBe('unknown');
  });
});

describe('resolvePersonByName', () => {
  it('returns null on empty/whitespace input', async () => {
    const db = makeMockDb();
    expect(await resolvePersonByName(db as never, '')).toBeNull();
    expect(await resolvePersonByName(db as never, '   ')).toBeNull();
    expect(await resolvePersonByName(db as never, null)).toBeNull();
    expect(await resolvePersonByName(db as never, undefined)).toBeNull();
    expect(db.person.create).not.toHaveBeenCalled();
  });

  it('matches an existing Person case-insensitively', async () => {
    const db = makeMockDb();
    db._state.people.push({
      id: 'aaron-existing',
      name: 'Aaron Levy',
      email: 'aaron@portx.io',
      role: 'PM',
      defaultCapacityPct: 100,
      isAdmin: false,
    });
    const id = await resolvePersonByName(db as never, 'aaron levy');
    expect(id).toBe('aaron-existing');
    expect(db.person.create).not.toHaveBeenCalled();
  });

  it('creates a new Person with synthetic email when no match', async () => {
    const db = makeMockDb();
    const id = await resolvePersonByName(db as never, 'Sarah Imported');
    expect(id).toBe('person-1');
    expect(db.person.create).toHaveBeenCalledTimes(1);
    const created = db._state.people[0]!;
    expect(created.name).toBe('Sarah Imported');
    expect(created.email).toBe('sarah-imported@torii.unresolved');
    expect(created.role).toBe('Viewer');
  });

  it('appends -2 / -3 on synthetic-email collisions', async () => {
    const db = makeMockDb();
    db._state.people.push({
      id: 'existing-1',
      name: 'Different person',
      email: 'aaron-levy@torii.unresolved',
      role: 'Viewer',
      defaultCapacityPct: 100,
      isAdmin: false,
    });
    const id = await resolvePersonByName(db as never, 'Aaron Levy');
    expect(id).toBe('person-1');
    const created = db._state.people[1]!;
    expect(created.email).toBe('aaron-levy-2@torii.unresolved');
  });
});

describe('resolveProjectRolePeople', () => {
  it('resolves all three roles on a single project', async () => {
    const db = makeMockDb();
    db._state.people.push({
      id: 'existing-aaron',
      name: 'Aaron Levy',
      email: 'aaron@portx.io',
      role: 'PM',
      defaultCapacityPct: 100,
      isAdmin: false,
    });
    const result = await resolveProjectRolePeople({
      db: db as never,
      projectId: 'proj-1',
      details: {
        project_manager: 'aaron levy',
        solution_architect: 'Vitor Barros',
        solution_consultant: 'Halan Lima',
      },
    });
    expect(result.projectManagerId).toBe('existing-aaron');
    expect(result.solutionArchitectId).toBe('person-1');
    expect(result.solutionConsultantId).toBe('person-2');
    expect(db.project.update).toHaveBeenCalledWith({
      where: { id: 'proj-1' },
      data: {
        projectManagerId: 'existing-aaron',
        solutionArchitectId: 'person-1',
        solutionConsultantId: 'person-2',
      },
    });
  });

  it('skips empty strings, returns null FKs for those', async () => {
    const db = makeMockDb();
    const result = await resolveProjectRolePeople({
      db: db as never,
      projectId: 'proj-1',
      details: {
        project_manager: 'Aaron Levy',
        solution_architect: '',
        // solution_consultant is undefined
      },
    });
    expect(result.projectManagerId).toBe('person-1');
    expect(result.solutionArchitectId).toBeNull();
    expect(result.solutionConsultantId).toBeNull();
  });

  it('handles null/undefined details by setting all FKs to null', async () => {
    const db = makeMockDb();
    const result = await resolveProjectRolePeople({
      db: db as never,
      projectId: 'proj-1',
      details: null,
    });
    expect(result).toEqual({
      projectManagerId: null,
      solutionArchitectId: null,
      solutionConsultantId: null,
    });
    expect(db.person.create).not.toHaveBeenCalled();
  });
});
