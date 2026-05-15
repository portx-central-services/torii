import type { Role } from '@torii/shared';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  isAdmin: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}
