import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import { db } from '../../db/client.js';
import { categories, ruleSplits, rules, transactionSplits, transactions } from '../../db/schema.js';
import { compileRule, firstMatch, type CompiledRule, type CompiledRuleSplit } from './matcher.js';
import { computeSplitCents } from './split-cents.js';

// Callers that already own an outer DB transaction can pass `tx` so the
// rule-engine's SELECTs run *on that transaction* rather than through the
// top-level `db` client. On PGlite (single connection) not passing `tx`
// would deadlock: `db.transaction()` is holding the connection, and
// `db.select()` here queues waiting for it to be released.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Runner = typeof db | PgTransaction<any, any, any>;

export interface RecategorizeOptions {
  userId: number;
  preserveManual: boolean;
}

export interface RecategorizeResult {
  total: number;
  recategorized: number;
  splitsEmitted: number;
  unknown: number;
  preserved: number;
}

const BATCH = 500;

async function loadCompiledRules(userId: number, runner: Runner = db): Promise<CompiledRule[]> {
  const rs = await runner
    .select()
    .from(rules)
    .where(and(eq(rules.userId, userId), eq(rules.enabled, true)))
    .orderBy(desc(rules.priority), rules.id);
  if (rs.length === 0) return [];

  // Hydrate rule_splits per rule via a single grouped SELECT — the engine's
  // hot path can then check `compiled.splits` without additional round-trips.
  const splitRows = await runner
    .select({
      ruleId: ruleSplits.ruleId,
      categoryId: ruleSplits.categoryId,
      percent: ruleSplits.percent,
      position: ruleSplits.position,
    })
    .from(ruleSplits)
    .where(inArray(ruleSplits.ruleId, rs.map((r) => r.id)))
    .orderBy(asc(ruleSplits.ruleId), asc(ruleSplits.position), asc(ruleSplits.id));
  const splitsByRule = new Map<number, CompiledRuleSplit[]>();
  for (const s of splitRows) {
    const arr = splitsByRule.get(s.ruleId) ?? [];
    arr.push({ categoryId: s.categoryId, percent: s.percent });
    splitsByRule.set(s.ruleId, arr);
  }

  return rs.map((r) => {
    const c = compileRule(r);
    const splits = splitsByRule.get(r.id);
    return splits && splits.length >= 2 ? { ...c, splits } : c;
  });
}

async function loadDefaultCategoryId(userId: number, runner: Runner = db): Promise<number | null> {
  const [d] = await runner
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.userId, userId), eq(categories.isDefault, true)))
    .limit(1);
  return d?.id ?? null;
}

// Writes N split rows (from the CompiledRule.splits array, scaled against the
// parent amount) and stamps the parent's categoryId, category_source='auto',
// splits_source='auto' — all in one transaction so the deferred sum trigger
// commits cleanly. Caller controls the outer scope; on PGlite, always pass a
// `tx` runner (top-level `db.transaction` around a fresh categorization).
export async function emitAutoSplits(
  runner: Runner,
  parentTxId: number,
  parentAmount: number,
  rule: CompiledRule,
): Promise<number> {
  const splits = rule.splits;
  if (!splits || splits.length < 2) return 0;
  const parentCents = Math.round(parentAmount * 100);
  if (parentCents === 0) return 0;
  const cents = computeSplitCents(parentCents, splits.map((s) => s.percent));

  // Replace any prior splits on this parent (defensive — recategorizeAll
  // filters by splits_source before reaching here, but a lone categorizeOne
  // caller might not).
  await runner.delete(transactionSplits).where(eq(transactionSplits.transactionId, parentTxId));
  await runner.insert(transactionSplits).values(
    splits.map((s, i) => ({
      transactionId: parentTxId,
      categoryId: s.categoryId,
      amount: (cents[i]! / 100).toFixed(2),
    })),
  );
  await runner
    .update(transactions)
    .set({ categoryId: rule.rule.categoryId, categorySource: 'auto', splitsSource: 'auto' })
    .where(eq(transactions.id, parentTxId));
  return splits.length;
}

// Apply the current rule set to every non-transfer transaction.
// Honors `preserveManual` — rows tagged category_source = 'manual' are left
// alone when the flag is set (the default in the API). Splits with
// splits_source='manual' are ALWAYS preserved regardless of the flag: a
// user's hand-tuned ventilation must never be overwritten by an engine pass.
export async function recategorizeAll(opts: RecategorizeOptions): Promise<RecategorizeResult> {
  const compiled = await loadCompiledRules(opts.userId);
  const defaultId = await loadDefaultCategoryId(opts.userId);

  const txs = await db
    .select({
      id: transactions.id,
      amount: transactions.amount,
      normalizedLabel: transactions.normalizedLabel,
      categorySource: transactions.categorySource,
      splitsSource: transactions.splitsSource,
    })
    .from(transactions)
    .where(and(eq(transactions.userId, opts.userId), isNull(transactions.transferGroupId)));

  const autoBuckets = new Map<number, number[]>();
  const splitEmits: Array<{ txId: number; amount: number; rule: CompiledRule }> = [];
  const defaultBucket: number[] = [];
  const clearSplitsFor: number[] = [];
  let preserved = 0;
  let recategorized = 0;
  let splitsEmitted = 0;
  let unknown = 0;

  for (const t of txs) {
    // Ventilation ownership: a user-tuned split set is untouchable.
    if (t.splitsSource === 'manual') { preserved++; continue; }
    if (opts.preserveManual && t.categorySource === 'manual') { preserved++; continue; }

    const amount = Number(t.amount);
    const hit = firstMatch(compiled, t.normalizedLabel, amount);
    if (hit && hit.splits && hit.splits.length >= 2) {
      splitEmits.push({ txId: t.id, amount, rule: hit });
      splitsEmitted++;
    } else if (hit) {
      const arr = autoBuckets.get(hit.rule.categoryId) ?? [];
      arr.push(t.id);
      autoBuckets.set(hit.rule.categoryId, arr);
      recategorized++;
      // A tx that had auto-splits previously but now matches a single-category
      // rule must have those splits cleared so the parent's category_id
      // becomes authoritative again.
      if (t.splitsSource === 'auto') clearSplitsFor.push(t.id);
    } else {
      defaultBucket.push(t.id);
      unknown++;
      if (t.splitsSource === 'auto') clearSplitsFor.push(t.id);
    }
  }

  // Clear any leftover auto-splits from transactions that no longer match a
  // split rule — before we UPDATE the parent's amount-locked state.
  if (clearSplitsFor.length > 0) {
    for (let i = 0; i < clearSplitsFor.length; i += BATCH) {
      const slice = clearSplitsFor.slice(i, i + BATCH);
      await db.transaction(async (tx) => {
        await tx.delete(transactionSplits).where(inArray(transactionSplits.transactionId, slice));
        await tx
          .update(transactions)
          .set({ splitsSource: null })
          .where(inArray(transactions.id, slice));
      });
    }
  }

  for (const [categoryId, ids] of autoBuckets) {
    for (let i = 0; i < ids.length; i += BATCH) {
      const slice = ids.slice(i, i + BATCH);
      await db
        .update(transactions)
        .set({ categoryId, categorySource: 'auto' })
        .where(inArray(transactions.id, slice));
    }
  }

  if (defaultBucket.length && defaultId !== null) {
    for (let i = 0; i < defaultBucket.length; i += BATCH) {
      const slice = defaultBucket.slice(i, i + BATCH);
      await db
        .update(transactions)
        .set({ categoryId: defaultId, categorySource: 'default' })
        .where(inArray(transactions.id, slice));
    }
  }

  // Split emissions run last (they touch transaction_splits, which the amount
  // lock trigger cares about) and one-per-tx inside a single transaction each
  // so the deferred sum trigger validates at commit.
  for (const e of splitEmits) {
    await db.transaction(async (tx) => {
      await emitAutoSplits(tx, e.txId, e.amount, e.rule);
    });
  }

  return { total: txs.length, recategorized, splitsEmitted, unknown, preserved };
}

// Per-transaction application used at import time. Caller decides the
// transaction scope. When the matched rule has splits (rule_splits ≥ 2),
// emits transaction_splits + stamps splits_source='auto' on the parent;
// otherwise sets the single category as before.
export async function categorizeOne(
  compiled: readonly CompiledRule[],
  defaultId: number | null,
  txId: number,
  amount: number,
  normalizedLabel: string,
  runner: Runner = db,
): Promise<{ categoryId: number | null; source: 'auto' | 'default'; emittedSplits: number }> {
  const hit = firstMatch(compiled, normalizedLabel, amount);
  if (hit && hit.splits && hit.splits.length >= 2) {
    const emitted = await emitAutoSplits(runner, txId, amount, hit);
    return { categoryId: hit.rule.categoryId, source: 'auto', emittedSplits: emitted };
  }
  if (hit) {
    await runner
      .update(transactions)
      .set({ categoryId: hit.rule.categoryId, categorySource: 'auto' })
      .where(eq(transactions.id, txId));
    return { categoryId: hit.rule.categoryId, source: 'auto', emittedSplits: 0 };
  }
  if (defaultId !== null) {
    await runner
      .update(transactions)
      .set({ categoryId: defaultId, categorySource: 'default' })
      .where(eq(transactions.id, txId));
  }
  return { categoryId: defaultId, source: 'default', emittedSplits: 0 };
}

export async function loadRuleEngine(userId: number, runner: Runner = db) {
  const [compiled, defaultId] = await Promise.all([
    loadCompiledRules(userId, runner),
    loadDefaultCategoryId(userId, runner),
  ]);
  return { compiled, defaultId };
}

// Kept for compatibility with a future caller that only wants to check
// "does this rule set contain any split-mode rules?" without running the
// engine. Not used today.
export function hasAnySplitMode(compiled: readonly CompiledRule[]): boolean {
  return compiled.some((c) => c.splits && c.splits.length >= 2);
}

// Silence unused-import warning under the current codepath — `sql` is
// retained for future imports.ts fan-out helpers that emit splits directly.
void sql;
