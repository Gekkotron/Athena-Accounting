import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { fxRates } from '../../db/schema.js';
import { isPgError, parseId } from '../../lib/http.js';
import { userId } from '../plugins/auth.js';

const CcyCode = z.string().regex(/^[A-Z]{3}$/);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Rate = z
  .string()
  .regex(/^\d+(\.\d{1,10})?$/)
  .refine((s) => Number(s) > 0, 'rate must be > 0');

export const CreateBody = z.object({
  from: CcyCode,
  to: CcyCode,
  effectiveFrom: IsoDate,
  rate: Rate,
}).refine((v) => v.from !== v.to, { path: ['to'], message: 'from and to must differ' });

export const PatchBody = z.object({
  rate: Rate.optional(),
  effectiveFrom: IsoDate.optional(),
}).refine((v) => v.rate !== undefined || v.effectiveFrom !== undefined, {
  message: 'nothing to update',
});

function shape(row: typeof fxRates.$inferSelect) {
  return {
    id: row.id,
    from: row.fromCcy,
    to: row.toCcy,
    effectiveFrom: String(row.effectiveFrom),
    rate: String(row.rate),
  };
}

export async function fxRatesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.get('/api/fx-rates', async (req) => {
    const uid = userId(req);
    const rows = await db.select().from(fxRates).where(eq(fxRates.userId, uid));
    return {
      rates: rows
        .sort((a, b) =>
          a.fromCcy.localeCompare(b.fromCcy) ||
          a.toCcy.localeCompare(b.toCcy) ||
          String(b.effectiveFrom).localeCompare(String(a.effectiveFrom)),
        )
        .map(shape),
    };
  });

  app.post('/api/fx-rates', async (req, reply) => {
    const uid = userId(req);
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const { from, to, effectiveFrom, rate } = parsed.data;
    try {
      const [row] = await db
        .insert(fxRates)
        .values({ userId: uid, fromCcy: from, toCcy: to, effectiveFrom, rate })
        .returning();
      return reply.code(201).send({ rate: shape(row!) });
    } catch (err: unknown) {
      if (isPgError(err) && err.code === '23505') {
        return reply.code(409).send({ error: 'conflict', code: 'DUPLICATE_RATE' });
      }
      throw err;
    }
  });

  app.patch('/api/fx-rates/:id', async (req, reply) => {
    const uid = userId(req);
    const id = parseId(req, reply);
    if (id === null) return;
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    try {
      const [row] = await db
        .update(fxRates)
        .set(parsed.data)
        .where(and(eq(fxRates.id, id), eq(fxRates.userId, uid)))
        .returning();
      if (!row) return reply.code(404).send({ error: 'not_found' });
      return { rate: shape(row) };
    } catch (err: unknown) {
      if (isPgError(err) && err.code === '23505') {
        return reply.code(409).send({ error: 'conflict', code: 'DUPLICATE_RATE' });
      }
      throw err;
    }
  });

  app.delete('/api/fx-rates/:id', async (req, reply) => {
    const uid = userId(req);
    const id = parseId(req, reply);
    if (id === null) return;
    await db.delete(fxRates).where(and(eq(fxRates.id, id), eq(fxRates.userId, uid)));
    return reply.code(204).send();
  });
}
