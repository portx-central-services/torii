import { PrismaClient } from '@prisma/client';

let cached: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (!cached) {
    cached = new PrismaClient();
  }
  return cached;
}

export type DB = PrismaClient;
