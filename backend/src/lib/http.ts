import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

// Shared zod schema for `:id` path params. Coerced from string because Fastify
// hands us params as strings.
export const IdParam = z.object({ id: z.coerce.number().int().positive() });

// Extract and validate `:id` from Fastify's route params, replying 400 and
// returning null on invalid input. Callers must return immediately when null.
export function parseId(req: FastifyRequest, reply: FastifyReply): number | null {
  const r = IdParam.safeParse(req.params);
  if (!r.success) {
    reply.code(400).send({ error: 'invalid id' });
    return null;
  }
  return r.data.id;
}

// True when `err` is a Postgres driver error with a `.code` string set. Used
// to distinguish 23505 (unique_violation) and 23503 (foreign_key_violation)
// from generic exceptions without pulling the whole `pg` type surface.
export function isPgError(err: unknown): err is { code: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string'
  );
}

// Structured HTTP-status-carrying error. Route handlers can `throw new
// HttpError(404, 'not found')` and the global setErrorHandler maps it to the
// wire response — no need to thread `reply` through every helper.
export class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly extra?: Record<string, unknown>) {
    super(message);
    this.name = 'HttpError';
  }
}
