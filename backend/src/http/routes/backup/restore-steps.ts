import type { FastifyBaseLogger } from 'fastify';
import { db } from '../../../db/client.js';
import {
  accountFilenamePatterns,
  accounts,
  balanceCheckpoints,
  categories,
  categoryBudgets,
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

  for (const c of rootRows) {
    const [inserted] = await tx
      .insert(categories)
      .values({
        userId: uid,
        name: c.name,
        kind: normalizeCategoryKind(c.kind),
        color: c.color ?? null,
        parentId: null,
        isDefault: c.isDefault,
        isInternalTransfer: c.isInternalTransfer ?? false,
      })
      .returning({ id: categories.id });
    if (inserted) {
      categoryIdByPath.set(`::${c.name}`, inserted.id);
      const arr = categoryIdsByName.get(c.name) ?? [];
      arr.push(inserted.id);
      categoryIdsByName.set(c.name, arr);
      if (c.isDefault) defaultId = inserted.id;
    }
  }

  for (const c of childRows) {
    const parentId = categoryIdByPath.get(`::${c.parent!}`);
    if (parentId == null) {
      // Parent didn't restore (self-orphan or missing) — skip this child;
      // its downstream refs will fall through to the name-only fallback.
      continue;
    }
    const [inserted] = await tx
      .insert(categories)
      .values({
        userId: uid,
        name: c.name,
        kind: normalizeCategoryKind(c.kind),
        color: c.color ?? null,
        parentId,
        isDefault: c.isDefault,
        isInternalTransfer: c.isInternalTransfer ?? false,
      })
      .returning({ id: categories.id });
    if (inserted) {
      categoryIdByPath.set(`${c.parent!}::${c.name}`, inserted.id);
      const arr = categoryIdsByName.get(c.name) ?? [];
      arr.push(inserted.id);
      categoryIdsByName.set(c.name, arr);
      if (c.isDefault) defaultId = inserted.id;
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
  for (const p of patterns) {
    const accId = resolveNameToId(p.account, accountIdByName);
    if (accId === null) continue;
    await tx.insert(accountFilenamePatterns).values({
      userId: uid,
      pattern: p.pattern,
      accountId: accId,
      priority: p.priority,
    });
  }
}

export async function restoreRules(
  tx: Tx,
  uid: number,
  dumpRules: BackupDump['rules'],
  cats: CategoryMaps,
): Promise<number> {
  let inserted = 0;
  for (const r of dumpRules) {
    const catId = resolveCategoryRef(r.category, r.categoryParent, cats.categoryIdByPath, cats.categoryIdsByName);
    if (catId === null) continue;
    await tx.insert(rules).values({
      userId: uid,
      keyword: r.keyword,
      categoryId: catId,
      signConstraint: r.signConstraint,
      matchMode: r.matchMode,
      priority: r.priority,
      enabled: r.enabled,
    });
    inserted++;
  }
  return inserted;
}

export async function restoreBalanceCheckpoints(
  tx: Tx,
  uid: number,
  dumpCheckpoints: NonNullable<BackupDump['balanceCheckpoints']>,
  accountIdByName: Map<string, number>,
): Promise<number> {
  let inserted = 0;
  for (const c of dumpCheckpoints) {
    const accId = resolveNameToId(c.account, accountIdByName);
    if (accId === null) continue;
    await tx.insert(balanceCheckpoints).values({
      userId: uid,
      accountId: accId,
      checkpointDate: c.checkpointDate,
      expectedAmount: c.expectedAmount,
      note: c.note ?? null,
    });
    inserted++;
  }
  return inserted;
}

export async function restoreBudgets(
  tx: Tx,
  uid: number,
  dumpBudgets: NonNullable<BackupDump['budgets']>,
  accountIdByName: Map<string, number>,
  cats: CategoryMaps,
  log: FastifyBaseLogger,
): Promise<number> {
  let inserted = 0;
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
    await tx.insert(categoryBudgets).values({
      userId: uid,
      categoryId: catId,
      monthlyLimit: b.monthlyLimit,
      currency: b.currency,
      period: b.period ?? 'monthly',
      accountId: budgetAccountId,
    });
    inserted++;
  }
  return inserted;
}
