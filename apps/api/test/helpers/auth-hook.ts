import type { FastifyInstance } from 'fastify';
import type { AuthenticatedUser } from '../../src/types.js';

/**
 * Helper for tests: injects a fake authenticated user on every request, AFTER
 * the real session hook has run. The real session hook still runs but finds no
 * cookie and is a no-op; this hook then sets `request.user` from the value
 * provided. Mutate the returned ref to change the user mid-test.
 */
export function attachFakeUser(app: FastifyInstance, user: AuthenticatedUser | null) {
  const ref = { current: user };
  app.addHook('preHandler', async (request) => {
    if (ref.current) request.user = ref.current;
  });
  return ref;
}

export const pmUser: AuthenticatedUser = {
  id: 'pm-1',
  email: 'pm@portx.io',
  name: 'PM One',
  role: 'PM',
  isAdmin: false,
};

export const viewerUser: AuthenticatedUser = {
  id: 'viewer-1',
  email: 'viewer@portx.io',
  name: 'Viewer One',
  role: 'Viewer',
  isAdmin: false,
};
