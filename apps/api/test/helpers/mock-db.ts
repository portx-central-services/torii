import { vi } from 'vitest';
import type { DB } from '../../src/db.js';

export function makeMockDB(): DB {
  const noop = vi.fn();
  const findUnique = vi.fn();
  const findFirst = vi.fn();
  const findMany = vi.fn();
  const create = vi.fn();
  const update = vi.fn();
  const deleteOne = vi.fn();
  const upsert = vi.fn();
  const transaction = vi.fn();
  const queryRaw = vi.fn();

  // Minimal Prisma-shaped object, cast to DB
  return {
    session: {
      findUnique,
      findFirst,
      findMany,
      create,
      update,
      delete: deleteOne,
    },
    person: {
      findUnique,
      findFirst,
      findMany,
      create,
      update,
      upsert,
      delete: deleteOne,
    },
    project: {
      findUnique,
      findFirst,
      findMany,
      create,
      update,
      delete: deleteOne,
      count: noop,
    },
    allocation: {
      findUnique,
      findFirst,
      findMany,
      create,
      update,
      delete: deleteOne,
    },
    trackerConnection: {
      findUnique,
      findFirst,
      findMany,
      create,
      update,
      delete: deleteOne,
    },
    phaseAuditLog: {
      findMany,
      create,
    },
    $transaction: transaction,
    $queryRaw: queryRaw,
  } as unknown as DB;
}
