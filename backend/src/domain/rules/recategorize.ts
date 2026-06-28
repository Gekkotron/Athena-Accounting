import { desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { categories, rules, transactions } from '../../db/schema.js';
import { compileRule, firstMatch, type CompiledRule } from './matcher.js';

export interface RecategorizeOptions {
  preserveManual: boolean;
}

export interface RecategorizeResult {
  total: number;
  recategorized: number;
  unknown: number;
  preserved: number;
}

const BATCH = 500;

async function loadCompiledRules(): Promise<CompiledRule[]> {
  const rs = await db
    .select()
    .from(rules)
    .where(eq(rules.enabled, true))
    .orderBy(desc(rules.priority), rules.id);
  return rs.map(compileRule);
}

async function loadDefaultCategoryId(): Promise<number | null> {
  const [d] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.isDefault, true))
    .limit(1);
  return d?.id ?? null;
}

// Apply the current rule set to every non-transfer transaction.
// Honors `preserveManual` — rows tagged category_source = 'manual' are left
// alone when the flag is set (the default in the API).
export async function recategorizeAll(opts: RecategorizeOptions): Promise<RecategorizeResult> {
  const compiled = await loadCompiledRules();
  const defaultId = await loadDefaultCategoryId();

  const txs = await db
    .select({
      id: transactions.id,
      amount: transactions.amount,
      normalizedLabel: transactions.normalizedLabel,
      categorySource: transactions.categorySource,
    })
    .from(transactions)
    .where(isNull(transactions.transferGroupId));

  // Bucket per target category, so we can flush as IN(...) batched updates.
  const autoBuckets = new Map<number, number[]>();
  const defaultBucket: number[] = [];
  let preserved = 0;
  let recategorized = 0;
  let unknown = 0;

  for (const t of txs) {
    if (opts.preserveManual && t.categorySource === 'manual') {
      preserved++;
      continue;
    }
    const amount = Number(t.amount);
    const hit = firstMatch(compiled, t.normalizedLabel, amount);
    if (hit) {
      const arr = autoBuckets.get(hit.rule.categoryId) ?? [];
      arr.push(t.id);
      autoBuckets.set(hit.rule.categoryId, arr);
      recategorized++;
    } else {
      defaultBucket.push(t.id);
      unknown++;
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

  return { total: txs.length, recategorized, unknown, preserved };
}

// Per-transaction application used at import time. Caller decides the
// transaction scope.
export async function categorizeOne(
  compiled: readonly CompiledRule[],
  defaultId: number | null,
  txId: number,
  amount: number,
  normalizedLabel: string,
): Promise<{ categoryId: number | null; source: 'auto' | 'default' }> {
  const hit = firstMatch(compiled, normalizedLabel, amount);
  if (hit) {
    await db
      .update(transactions)
      .set({ categoryId: hit.rule.categoryId, categorySource: 'auto' })
      .where(eq(transactions.id, txId));
    return { categoryId: hit.rule.categoryId, source: 'auto' };
  }
  if (defaultId !== null) {
    await db
      .update(transactions)
      .set({ categoryId: defaultId, categorySource: 'default' })
      .where(eq(transactions.id, txId));
  }
  return { categoryId: defaultId, source: 'default' };
}

export async function loadRuleEngine() {
  const [compiled, defaultId] = await Promise.all([
    loadCompiledRules(),
    loadDefaultCategoryId(),
  ]);
  return { compiled, defaultId };
}
