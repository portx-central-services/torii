import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { ToriiError, ValidationError } from '@torii/shared';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof ToriiError) {
      const body: Record<string, unknown> = { error: err.message, code: err.code };
      if (err instanceof ValidationError && err.details !== undefined) {
        body.details = err.details;
      }
      reply.code(err.status).send(body);
      return;
    }

    if (err instanceof ZodError) {
      reply.code(400).send({
        error: 'Validation failed',
        code: 'validation_error',
        details: err.errors,
      });
      return;
    }

    // Fastify validation errors (from schema attached to route)
    const validation = (err as { validation?: unknown }).validation;
    const message = (err as { message?: string }).message ?? 'Bad request';
    if (validation) {
      reply.code(400).send({
        error: message,
        code: 'validation_error',
        details: validation,
      });
      return;
    }

    app.log.error(err as Error);
    reply.code(500).send({ error: 'Internal server error', code: 'internal_error' });
  });
}
