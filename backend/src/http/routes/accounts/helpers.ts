import type { FastifyReply, FastifyRequest } from 'fastify';
import { IdParam } from './schemas.js';

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
