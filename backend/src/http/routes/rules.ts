import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { categories, ruleSplits, rules, transactions } from '../../db/schema.js';
import { compileRule, isSafeRulePattern, type Rule } from '../../domain/rules/matcher.js';
import { recategorizeAll } from '../../domain/rules/recategorize.js';
import { isPgError, parseId } from '../../lib/http.js';
import { userId } from '../plugins/auth.js';

// A rule can carry an optional splits payload (migration 0042) — when
// present, ≥2 rows summing to exactly 100 % turn the rule into
// split-mode. The engine emits transaction_splits on match instead of
// stamping a single categoryId. See
// docs/superpowers/specs/2026-09-16-rule-auto-splits-design.md.
const SplitInput = z.object({
  categoryId: z.number().int().positive(),
  percent: z.number().int().min(1).max(99),
});
const SplitsArray = z.array(SplitInput).min(2).max(20);

const CreateBody = z.object({
  categoryId: z.number().int().positive(),
  keyword: z.string().trim().min(1).max(256),
  signConstraint: z.enum(['positive', 'negative', 'any']).default('any'),
  matchMode: z.enum(['word', 'substring', 'regex']).default('word'),
  priority: z.number().int().min(0).max(1000).default(0),
  enabled: z.boolean().default(true),
  splits: SplitsArray.optional(),
});

// PUT accepts a partial patch. `splits` here is a three-state field:
//   - undefined: leave the current rule_splits set untouched
//   - null or empty array: revert the rule to single-category mode
//   - non-empty array: replace the current set
const UpdateBody = CreateBody.omit({ splits: true }).partial().extend({
  splits: z.union([SplitsArray, z.null(), z.array(SplitInput).length(0)]).optional(),
});

function guardRegexPattern(body: { matchMode?: string; keyword?: string }): string | null {
  if (body.matchMode !== 'regex' || typeof body.keyword !== 'string') return null;
  const check = isSafeRulePattern(body.keyword);
  return check.ok ? null : check.reason;
}

function validateSplitsPayload(splits: z.infer<typeof SplitsArray>): string | null {
  const total = splits.reduce((acc, s) => acc + s.percent, 0);
  if (total !== 100) return 'la somme des ventilations doit faire exactement 100';
  return null;
}

async function assertCategoriesOwned(
  uid: number,
  ids: readonly number[],
): Promise<boolean> {
  const wanted = Array.from(new Set(ids));
  const owned = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.userId, uid), inArray(categories.id, wanted)));
  return owned.length === wanted.length;
}

const RecatBody = z.object({ preserveManual: z.boolean().default(true) });

const PreviewBody = z.object({
  keyword: z.string().trim().min(1).max(256),
  signConstraint: z.enum(['positive', 'negative', 'any']).default('any'),
  matchMode: z.enum(['word', 'substring', 'regex']).default('word'),
  accountId: z.number().int().positive().optional(),
});

const PREVIEW_MATCH_LIMIT = 20;

// Fetch each rule's splits in one grouped query, matches the loadCompiledRules
// pattern from the engine — cheap for the O(rules) list.
async function hydrateSplitsForRules(
  ruleIds: readonly number[],
): Promise<Map<number, Array<{ categoryId: number | null; percent: number }>>> {
  const out = new Map<number, Array<{ categoryId: number | null; percent: number }>>();
  if (ruleIds.length === 0) return out;
  const rows = await db
    .select({
      ruleId: ruleSplits.ruleId,
      categoryId: ruleSplits.categoryId,
      percent: ruleSplits.percent,
      position: ruleSplits.position,
    })
    .from(ruleSplits)
    .where(inArray(ruleSplits.ruleId, ruleIds as number[]))
    .orderBy(asc(ruleSplits.ruleId), asc(ruleSplits.position), asc(ruleSplits.id));
  for (const r of rows) {
    const arr = out.get(r.ruleId) ?? [];
    arr.push({ categoryId: r.categoryId, percent: r.percent });
    out.set(r.ruleId, arr);
  }
  return out;
}

export async function rulesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.get('/api/rules', async (req) => {
    const uid = userId(req);
    const rows = await db
      .select()
      .from(rules)
      .where(eq(rules.userId, uid))
      .orderBy(desc(rules.priority), rules.id);
    const splitsByRule = await hydrateSplitsForRules(rows.map((r) => r.id));
    return {
      rules: rows.map((r) => ({ ...r, splits: splitsByRule.get(r.id) ?? [] })),
    };
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
    const { splits, ...ruleData } = parsed.data;
    if (splits) {
      const sumError = validateSplitsPayload(splits);
      if (sumError) return reply.code(400).send({ error: sumError });
      const catIds = [ruleData.categoryId, ...splits.map((s) => s.categoryId)];
      if (!(await assertCategoriesOwned(uid, catIds))) {
        return reply.code(400).send({ error: 'catégorie inconnue' });
      }
    }
    try {
      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(rules)
          .values({ ...ruleData, userId: uid })
          .returning();
        if (!row) throw new Error('insert rules returned empty');
        if (splits) {
          await tx.insert(ruleSplits).values(
            splits.map((s, i) => ({
              ruleId: row.id,
              categoryId: s.categoryId,
              percent: s.percent,
              position: i,
            })),
          );
        }
        return row;
      });
      return reply.code(201).send({
        rule: { ...created, splits: splits ?? [] },
      });
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
    const { splits: splitsPatch, ...ruleFields } = parsed.data;

    // Ownership guard for split categories only fires when the patch
    // actually swaps them.
    if (Array.isArray(splitsPatch) && splitsPatch.length > 0) {
      const sumError = validateSplitsPayload(splitsPatch);
      if (sumError) return reply.code(400).send({ error: sumError });
      const catIds = splitsPatch.map((s) => s.categoryId);
      if (ruleFields.categoryId) catIds.push(ruleFields.categoryId);
      if (!(await assertCategoriesOwned(uid, catIds))) {
        return reply.code(400).send({ error: 'catégorie inconnue' });
      }
    }

    const updated = await db.transaction(async (tx) => {
      let row: typeof rules.$inferSelect | undefined;
      if (Object.keys(ruleFields).length > 0) {
        [row] = await tx
          .update(rules)
          .set(ruleFields)
          .where(and(eq(rules.id, id), eq(rules.userId, uid)))
          .returning();
      } else {
        [row] = await tx
          .select()
          .from(rules)
          .where(and(eq(rules.id, id), eq(rules.userId, uid)))
          .limit(1);
      }
      if (!row) return null;
      if (splitsPatch !== undefined) {
        await tx.delete(ruleSplits).where(eq(ruleSplits.ruleId, id));
        if (Array.isArray(splitsPatch) && splitsPatch.length > 0) {
          await tx.insert(ruleSplits).values(
            splitsPatch.map((s, i) => ({
              ruleId: id,
              categoryId: s.categoryId,
              percent: s.percent,
              position: i,
            })),
          );
        }
      }
      return row;
    });
    if (!updated) return reply.code(404).send({ error: 'not found' });

    const splitsByRule = await hydrateSplitsForRules([id]);
    return { rule: { ...updated, splits: splitsByRule.get(id) ?? [] } };
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

  // Dry-run a draft rule against the user's (non-transfer) history so false
  // positives surface before the rule is saved. Read-only: nothing is
  // written. Matching runs through the same compileRule the live engine
  // uses, so what the preview shows is exactly what /api/recategorize and
  // import-time bucketing would do.
  app.post('/api/rules/preview', async (req, reply) => {
    const uid = userId(req);
    const parsed = PreviewBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const patternError = guardRegexPattern(parsed.data);
    if (patternError) {
      return reply.code(400).send({ error: patternError });
    }
    const { keyword, signConstraint, matchMode, accountId } = parsed.data;
    const compiled = compileRule({ keyword, signConstraint, matchMode } as Rule);

    const where = [eq(transactions.userId, uid), isNull(transactions.transferGroupId)];
    if (accountId !== undefined) where.push(eq(transactions.accountId, accountId));
    const rows = await db
      .select({
        id: transactions.id,
        date: transactions.date,
        amount: transactions.amount,
        rawLabel: transactions.rawLabel,
        normalizedLabel: transactions.normalizedLabel,
        accountId: transactions.accountId,
      })
      .from(transactions)
      .where(and(...where))
      .orderBy(desc(transactions.date), desc(transactions.id));

    const matches: Array<{ id: number; date: string; amount: string; rawLabel: string; accountId: number }> = [];
    let totalCount = 0;
    for (const t of rows) {
      if (!compiled.test(t.normalizedLabel, Number(t.amount))) continue;
      totalCount++;
      if (matches.length < PREVIEW_MATCH_LIMIT) {
        matches.push({
          id: t.id, date: t.date, amount: t.amount,
          rawLabel: t.rawLabel, accountId: t.accountId,
        });
      }
    }
    return { matches, totalCount, limit: PREVIEW_MATCH_LIMIT };
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
