import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { accounts, balanceCheckpoints } from '../../db/schema.js';
import { userId } from '../plugins/auth.js';

const decimal = z
  .string()
  .regex(/^-?\d+(\.\d{1,2})?$/, 'must be a decimal with up to 2 fraction digits');

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be ISO date YYYY-MM-DD');

const CreateBody = z.object({
  checkpointDate: isoDate,
  expectedAmount: decimal,
  // Trim, treat empty/whitespace-only as omitted, cap length. Stored NULL when absent.
  note: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length <= 200, 'note too long (max 200)')
    .transform((s) => (s.length === 0 ? null : s))
    .optional()
    .nullable(),
});

const UpdateBody = z.object({
  expectedAmount: decimal.optional(),
  note: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length <= 200, 'note too long (max 200)')
    .transform((s) => (s.length === 0 ? null : s))
    .optional()
    .nullable(),
});

const AccountIdParam = z.object({ id: z.coerce.number().int().positive() });
const CpIdParam = z.object({
  id: z.coerce.number().int().positive(),
  cpId: z.coerce.number().int().positive(),
});

function parseAccountId(req: FastifyRequest, reply: FastifyReply): number | null {
  const r = AccountIdParam.safeParse(req.params);
  if (!r.success) {
    reply.code(400).send({ error: 'invalid id' });
    return null;
  }
  return r.data.id;
}

function parseCpParams(
  req: FastifyRequest,
  reply: FastifyReply,
): { accountId: number; cpId: number } | null {
  const r = CpIdParam.safeParse(req.params);
  if (!r.success) {
    reply.code(400).send({ error: 'invalid id' });
    return null;
  }
  return { accountId: r.data.id, cpId: r.data.cpId };
}

async function ensureAccountOwned(uid: number, accountId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, uid)));
  return !!row;
}

function serialize(row: typeof balanceCheckpoints.$inferSelect) {
  return {
    id: row.id,
    accountId: row.accountId,
    checkpointDate: row.checkpointDate,
    expectedAmount: row.expectedAmount,
    note: row.note,
    createdAt: row.createdAt,
  };
}

function isPgError(err: unknown): err is { code: string } {
  return typeof err === 'object' && err !== null && 'code' in err && typeof (err as { code: unknown }).code === 'string';
}

export async function balanceCheckpointsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  // GET — list checkpoints for an account, oldest first.
  app.get('/api/accounts/:id/balance-checkpoints', async (req, reply) => {
    const uid = userId(req);
    const accountId = parseAccountId(req, reply);
    if (accountId === null) return;
    if (!(await ensureAccountOwned(uid, accountId))) {
      return reply.code(404).send({ error: 'not found' });
    }
    const rows = await db
      .select()
      .from(balanceCheckpoints)
      .where(and(
        eq(balanceCheckpoints.userId, uid),
        eq(balanceCheckpoints.accountId, accountId),
      ))
      .orderBy(asc(balanceCheckpoints.checkpointDate));
    return { checkpoints: rows.map(serialize) };
  });

  // POST — create a new checkpoint. 409 on (account, date) collision.
  app.post('/api/accounts/:id/balance-checkpoints', async (req, reply) => {
    const uid = userId(req);
    const accountId = parseAccountId(req, reply);
    if (accountId === null) return;
    if (!(await ensureAccountOwned(uid, accountId))) {
      return reply.code(404).send({ error: 'not found' });
    }
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    try {
      const [created] = await db
        .insert(balanceCheckpoints)
        .values({
          userId: uid,
          accountId,
          checkpointDate: parsed.data.checkpointDate,
          expectedAmount: parsed.data.expectedAmount,
          note: parsed.data.note ?? null,
        })
        .returning();
      return reply.code(201).send({ checkpoint: serialize(created!) });
    } catch (err) {
      if (isPgError(err) && err.code === '23505') {
        return reply.code(409).send({
          error: 'checkpoint_exists',
          date: parsed.data.checkpointDate,
        });
      }
      throw err;
    }
  });

  // PUT — patch expectedAmount and/or note. Date is immutable — the client
  // deletes + recreates to move a checkpoint.
  app.put('/api/accounts/:id/balance-checkpoints/:cpId', async (req, reply) => {
    const uid = userId(req);
    const params = parseCpParams(req, reply);
    if (!params) return;
    const parsed = UpdateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const patch: Partial<typeof balanceCheckpoints.$inferInsert> = {};
    if (parsed.data.expectedAmount !== undefined) patch.expectedAmount = parsed.data.expectedAmount;
    if (parsed.data.note !== undefined) patch.note = parsed.data.note;
    if (Object.keys(patch).length === 0) {
      return reply.code(400).send({ error: 'no fields to update' });
    }
    const [updated] = await db
      .update(balanceCheckpoints)
      .set(patch)
      .where(and(
        eq(balanceCheckpoints.id, params.cpId),
        eq(balanceCheckpoints.accountId, params.accountId),
        eq(balanceCheckpoints.userId, uid),
      ))
      .returning();
    if (!updated) return reply.code(404).send({ error: 'not found' });
    return { checkpoint: serialize(updated) };
  });

  // DELETE — 204 on success, 404 if the (id, cpId) pair isn't owned.
  app.delete('/api/accounts/:id/balance-checkpoints/:cpId', async (req, reply) => {
    const uid = userId(req);
    const params = parseCpParams(req, reply);
    if (!params) return;
    const [deleted] = await db
      .delete(balanceCheckpoints)
      .where(and(
        eq(balanceCheckpoints.id, params.cpId),
        eq(balanceCheckpoints.accountId, params.accountId),
        eq(balanceCheckpoints.userId, uid),
      ))
      .returning({ id: balanceCheckpoints.id });
    if (!deleted) return reply.code(404).send({ error: 'not found' });
    return reply.code(204).send();
  });
}
