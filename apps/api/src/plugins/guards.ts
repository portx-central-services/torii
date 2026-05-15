import type { FastifyRequest } from 'fastify';
import { UnauthorizedError, ForbiddenError } from '@torii/shared';
import type { AuthenticatedUser } from '../types.js';

export function requireUser(request: FastifyRequest): AuthenticatedUser {
  if (!request.user) throw new UnauthorizedError();
  return request.user;
}

export function requirePM(request: FastifyRequest): AuthenticatedUser {
  const user = requireUser(request);
  if (user.role !== 'PM') throw new ForbiddenError('PM role required');
  return user;
}

export function requireAdmin(request: FastifyRequest): AuthenticatedUser {
  const user = requireUser(request);
  if (!user.isAdmin) throw new ForbiddenError('Admin required');
  return user;
}
