import type { FastifyBaseLogger } from 'fastify';
import { db } from '../../../db/client.js';
import {
  accountFilenamePatterns,
  accounts,
  balanceCheckpoints,
  categories,
  categoryBudgets,
  ruleSplits,
  rules,
} from '../../../db/schema.js';
import type { BackupDump } from './schema.js';
import {
  normalizeCategoryKind,
  resolveCategoryRef,
  resolveNameToId,
} from './helpers.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type CategoryMaps = {
  categoryIdByPath: Map<string, number>;
  categoryIdsByName: Map<string, number[]>;
};

export async function restoreAccounts(
  tx: Tx,
  uid: number,
  dumpAccounts: BackupDump['accounts'],
): Promise<Map<string, number>> {
  const accountIdByName = new Map<string, number>();
  for (const a of dumpAccounts) {
    // Fold the legacy isInvestment flag (v2 backups) into the type column.
    // A v2 backup carrying isInvestment=true always meant "Placé" on the
    // Dashboard, regardless of the recorded type — mirror that here.
    const type = a.isInvestment ? 'investment' : a.type;
    const [inserted] = await tx
      .insert(accounts)
      .values({
        userId: uid,
        name: a.name,
        type,
        currency: a.currency,
        openingBalance: a.openingBalance,
        openingDate: a.openingDate,
        displayOrder: a.displayOrder ?? 0,
        lockYears: a.lockYears ?? null,
      })
      .returning({ id: accounts.id });
    if (inserted) accountIdByName.set(a.name, inserted.id);
  }
  return accountIdByName;
}

// Categories: keyed by path so same-name-under-different-parents doesn't collide.
// Also keeps a name→ids[] map for backward-compat resolution of v3 downstream
// refs. Seeds a Divers default when the dump didn't bring its own.
export async function restoreCategoryTree(
  tx: Tx,
  uid: number,
  dumpCategories: BackupDump['categories'],
): Promise<CategoryMaps> {
  const categoryIdByPath = new Map<string, number>();
  const categoryIdsByName = new Map<string, number[]>();
  let defaultId: number | null = null;

  const rootRows = dumpCategories.filter((c) => !c.parent);
  const childRows = dumpCategories.filter((c) => !!c.parent);

  // Roots: one bulk INSERT. RETURNING order matches VALUES order in
  // Postgres + PGlite, so we can zip returned ids back onto the input.
  if (rootRows.length > 0) {
    const returned = await tx
      .insert(categories)
      .values(rootRows.map((c) => ({
        userId: uid,
        name: c.name,
        kind: normalizeCategoryKind(c.kind),
        color: c.color ?? null,
        parentId: null,
        isDefault: c.isDefault,
        isInternalTransfer: c.isInternalTransfer ?? false,
      })))
      .returning({ id: categories.id });
    for (let i = 0; i < returned.length; i++) {
      const c = rootRows[i]!;
      const id = returned[i]!.id;
      categoryIdByPath.set(`::${c.name}`, id);
      const arr = categoryIdsByName.get(c.name) ?? [];
      arr.push(id);
      categoryIdsByName.set(c.name, arr);
      if (c.isDefault) defaultId = id;
    }
  }

  // Children: filter out orphans (parent didn't restore), then one bulk
  // INSERT. Parent ids come from the freshly-populated map, so this MUST
  // run after the roots pass commits its RETURNING.
  const resolvableChildren = childRows
    .map((c) => ({ c, parentId: categoryIdByPath.get(`::${c.parent!}`) ?? null }))
    .filter((r): r is { c: typeof childRows[number]; parentId: number } => r.parentId !== null);
  if (resolvableChildren.length > 0) {
    const returned = await tx
      .insert(categories)
      .values(resolvableChildren.map(({ c, parentId }) => ({
        userId: uid,
        name: c.name,
        kind: normalizeCategoryKind(c.kind),
        color: c.color ?? null,
        parentId,
        isDefault: c.isDefault,
        isInternalTransfer: c.isInternalTransfer ?? false,
      })))
      .returning({ id: categories.id });
    for (let i = 0; i < returned.length; i++) {
      const { c } = resolvableChildren[i]!;
      const id = returned[i]!.id;
      categoryIdByPath.set(`${c.parent!}::${c.name}`, id);
      const arr = categoryIdsByName.get(c.name) ?? [];
      arr.push(id);
      categoryIdsByName.set(c.name, arr);
      if (c.isDefault) defaultId = id;
    }
  }

  if (defaultId === null) {
    const [inserted] = await tx
      .insert(categories)
      .values({ userId: uid, name: 'Divers', kind: 'neutral', isDefault: true })
      .returning({ id: categories.id });
    if (inserted) {
      defaultId = inserted.id;
      categoryIdByPath.set('::Divers', inserted.id);
      categoryIdsByName.set('Divers', [inserted.id]);
    }
  }

  return { categoryIdByPath, categoryIdsByName };
}

export async function restoreFilenamePatterns(
  tx: Tx,
  uid: number,
  patterns: BackupDump['accountFilenamePatterns'],
  accountIdByName: Map<string, number>,
): Promise<void> {
  const rows: Array<typeof accountFilenamePatterns.$inferInsert> = [];
  for (const p of patterns) {
    const accId = resolveNameToId(p.account, accountIdByName);
    if (accId === null) continue;
    rows.push({ userId: uid, pattern: p.pattern, accountId: accId, priority: p.priority });
  }
  if (rows.length > 0) {
    await tx.insert(accountFilenamePatterns).values(rows);
  }
}

export async function restoreRules(
  tx: Tx,
  uid: number,
  dumpRules: BackupDump['rules'],
  cats: CategoryMaps,
): Promise<{ inserted: number; skippedSplits: number }> {
  let skippedSplits = 0;
  // Pre-resolve every rule's category + splits so the write path is a
  // pair of bulk INSERTs regardless of rule count.
  const resolved: Array<{
    values: typeof rules.$inferInsert;
    splits: Array<{ categoryId: number; percent: number }> | null;
  }> = [];
  for (const r of dumpRules) {
    const catId = resolveCategoryRef(r.category, r.categoryParent, cats.categoryIdByPath, cats.categoryIdsByName);
    if (catId === null) continue;
    // Split-mode rule: resolve every split's category first. If any one
    // can't be resolved, the whole rule is dropped — dropping only some
    // splits would break the sum=100 invariant.
    let resolvedSplits: Array<{ categoryId: number; percent: number }> | null = null;
    if (r.splits && r.splits.length > 0) {
      const acc: Array<{ categoryId: number; percent: number }> = [];
      let allResolved = true;
      for (const s of r.splits) {
        const sid = resolveCategoryRef(s.category, s.categoryParent, cats.categoryIdByPath, cats.categoryIdsByName);
        if (sid === null) { allResolved = false; break; }
        acc.push({ categoryId: sid, percent: s.percent });
      }
      if (!allResolved) { skippedSplits++; continue; }
      const sum = acc.reduce((a, s) => a + s.percent, 0);
      if (sum !== 100) { skippedSplits++; continue; }
      resolvedSplits = acc;
    }
    resolved.push({
      values: {
        userId: uid,
        keyword: r.keyword,
        categoryId: catId,
        signConstraint: r.signConstraint,
        matchMode: r.matchMode,
        priority: r.priority,
        enabled: r.enabled,
      },
      splits: resolvedSplits,
    });
  }
  if (resolved.length === 0) return { inserted: 0, skippedSplits };

  // Bulk INSERT of rules, then bulk INSERT of every split row keyed onto
  // the freshly-returned rule ids. RETURNING order matches VALUES order.
  const returned = await tx.insert(rules).values(resolved.map((r) => r.values)).returning({ id: rules.id });
  const splitRows: Array<typeof ruleSplits.$inferInsert> = [];
  for (let i = 0; i < returned.length; i++) {
    const splits = resolved[i]!.splits;
    if (!splits) continue;
    const ruleId = returned[i]!.id;
    for (let j = 0; j < splits.length; j++) {
      splitRows.push({ ruleId, categoryId: splits[j]!.categoryId, percent: splits[j]!.percent, position: j });
    }
  }
  if (splitRows.length > 0) {
    await tx.insert(ruleSplits).values(splitRows);
  }
  return { inserted: resolved.length, skippedSplits };
}

export async function restoreBalanceCheckpoints(
  tx: Tx,
  uid: number,
  dumpCheckpoints: NonNullable<BackupDump['balanceCheckpoints']>,
  accountIdByName: Map<string, number>,
): Promise<number> {
  const rows: Array<typeof balanceCheckpoints.$inferInsert> = [];
  for (const c of dumpCheckpoints) {
    const accId = resolveNameToId(c.account, accountIdByName);
    if (accId === null) continue;
    rows.push({
      userId: uid,
      accountId: accId,
      checkpointDate: c.checkpointDate,
      expectedAmount: c.expectedAmount,
      note: c.note ?? null,
    });
  }
  if (rows.length > 0) {
    await tx.insert(balanceCheckpoints).values(rows);
  }
  return rows.length;
}

export async function restoreBudgets(
  tx: Tx,
  uid: number,
  dumpBudgets: NonNullable<BackupDump['budgets']>,
  accountIdByName: Map<string, number>,
  cats: CategoryMaps,
  log: FastifyBaseLogger,
): Promise<number> {
  const rows: Array<typeof categoryBudgets.$inferInsert> = [];
  for (const b of dumpBudgets) {
    const catId = resolveCategoryRef(b.category, b.categoryParent, cats.categoryIdByPath, cats.categoryIdsByName);
    if (catId === null) continue;
    const budgetAccountId = resolveNameToId(b.account ?? null, accountIdByName);
    if (b.account != null && budgetAccountId == null) {
      // The dump's account name didn't resolve (e.g. renamed/removed
      // account). Skip rather than silently downgrading to a global
      // budget: if a global variant for the same (category, period)
      // already exists in the dump, that silent downgrade would hit the
      // unique index and abort the whole restore transaction.
      log.warn(
        { category: b.category, account: b.account },
        'restore: budget account name did not resolve; skipping scoped budget',
      );
      continue;
    }
    rows.push({
      userId: uid,
      categoryId: catId,
      monthlyLimit: b.monthlyLimit,
      currency: b.currency,
      period: b.period ?? 'monthly',
      accountId: budgetAccountId,
    });
  }
  if (rows.length > 0) {
    await tx.insert(categoryBudgets).values(rows);
  }
  return rows.length;
}
