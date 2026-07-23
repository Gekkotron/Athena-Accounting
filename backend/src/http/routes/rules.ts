import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { rules } from '../../db/schema.js';
import { isSafeRulePattern } from '../../domain/rules/matcher.js';
import { recategorizeAll } from '../../domain/rules/recategorize.js';
import { isPgError, parseId } from '../../lib/http.js';
import { userId } from '../plugins/auth.js';

const CreateBody = z.object({
  categoryId: z.number().int().positive(),
  keyword: z.string().trim().min(1).max(256),
  signConstraint: z.enum(['positive', 'negative', 'any']).default('any'),
  matchMode: z.enum(['word', 'substring', 'regex']).default('word'),
  priority: z.number().int().min(0).max(1000).default(0),
  enabled: z.boolean().default(true),
});

const UpdateBody = CreateBody.partial();

// POST /api/recategorize runs every rule against every transaction on the
// event loop, so a catastrophic-backtracking pattern would hang the process
// for every user. Only enforce this on 'regex' matchMode — 'word' and
// 'substring' build their own patterns and pass user text through
// escapeRegex first.
function guardRegexPattern(body: { matchMode?: string; keyword?: string }): string | null {
  if (body.matchMode !== 'regex' || typeof body.keyword !== 'string') return null;
  const check = isSafeRulePattern(body.keyword);
  return check.ok ? null : check.reason;
}
const RecatBody = z.object({ preserveManual: z.boolean().default(true) });

export async function rulesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.get('/api/rules', async (req) => {
    const uid = userId(req);
    const rows = await db
      .select()
      .from(rules)
      .where(eq(rules.userId, uid))
      .orderBy(desc(rules.priority), rules.id);
    return { rules: rows };
  });

  app.post('/api/rules', async (req, reply) => {
    const uid = userId(req);
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const patternError = guardRegexPattern(parsed.data);
    if (patternError) {
      return reply.code(400).send({ error: patternError });
    }
    try {
      const [created] = await db
        .insert(rules)
        .values({ ...parsed.data, userId: uid })
        .returning();
      return reply.code(201).send({ rule: created });
    } catch (err) {
      if (isPgError(err) && err.code === '23503') {
        return reply.code(400).send({ error: 'unknown categoryId' });
      }
      throw err;
    }
  });

  app.put('/api/rules/:id', async (req, reply) => {
    const uid = userId(req);
    const id = parseId(req, reply);
    if (id === null) return;
    const parsed = UpdateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    if (Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: 'no fields to update' });
    }
    const patternError = guardRegexPattern(parsed.data);
    if (patternError) {
      return reply.code(400).send({ error: patternError });
    }
    const [updated] = await db
      .update(rules)
      .set(parsed.data)
      .where(and(eq(rules.id, id), eq(rules.userId, uid)))
      .returning();
    if (!updated) return reply.code(404).send({ error: 'not found' });
    return { rule: updated };
  });

  app.delete('/api/rules/:id', async (req, reply) => {
    const uid = userId(req);
    const id = parseId(req, reply);
    if (id === null) return;
    const [deleted] = await db
      .delete(rules)
      .where(and(eq(rules.id, id), eq(rules.userId, uid)))
      .returning({ id: rules.id });
    if (!deleted) return reply.code(404).send({ error: 'not found' });
    return { ok: true };
  });

  // Re-run the engine over the entire (non-transfer) history. Default keeps
  // manual choices safe — pass {"preserveManual": false} to overwrite them too.
  app.post('/api/recategorize', async (req, reply) => {
    const uid = userId(req);
    const parsed = RecatBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const result = await recategorizeAll({ ...parsed.data, userId: uid });
    return result;
  });
}
