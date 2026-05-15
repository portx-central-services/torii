import type { FastifyInstance } from 'fastify';
import type { DB } from '../db.js';
import type { AuthenticatedUser } from '../types.js';

export const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

export interface SessionHookOptions {
  db: DB;
  cookieName: string;
}

export function registerSessionHook(app: FastifyInstance, opts: SessionHookOptions): void {
  app.addHook('onRequest', async (request) => {
    const raw = request.cookies[opts.cookieName];
    if (!raw) return;
    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return;
    const sessionId = unsigned.value;

    const session = await opts.db.session.findUnique({
      where: { id: sessionId },
      include: { person: true },
    });
    if (!session) return;
    if (session.expiresAt < new Date()) {
      await opts.db.session.delete({ where: { id: sessionId } }).catch(() => undefined);
      return;
    }

    // Sliding expiration
    const newExpiry = new Date(Date.now() + SESSION_TTL_MS);
    await opts.db.session.update({
      where: { id: sessionId },
      data: { expiresAt: newExpiry },
    });

    const user: AuthenticatedUser = {
      id: session.person.id,
      email: session.person.email,
      name: session.person.name,
      role: session.person.role,
      isAdmin: session.person.isAdmin,
    };
    request.user = user;
  });
}

export function buildSessionCookie(sessionId: string): {
  value: string;
  options: {
    httpOnly: boolean;
    sameSite: 'lax';
    secure: boolean;
    path: string;
    maxAge: number;
    signed: boolean;
  };
} {
  return {
    value: sessionId,
    options: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
      signed: true,
    },
  };
}
