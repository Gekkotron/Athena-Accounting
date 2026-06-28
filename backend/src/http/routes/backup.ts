import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  accounts,
  accountFilenamePatterns,
  categories,
  fileImports,
  rules,
  transactions,
  transferRules,
} from '../../db/schema.js';

// Versioned envelope. Bump `version` when the shape changes in a non-additive
// way — the importer refuses unknown versions outright.
const VERSION = 1;

const categoryKind = z.enum(['expense', 'income', 'transfer', 'neutral']);
const signConstraint = z.enum(['positive', 'negative', 'any']);
const matchMode = z.enum(['word', 'substring', 'regex']);
const categorySource = z.enum(['manual', 'auto', 'default', 'llm']);
const transferDirection = z.enum(['outgoing', 'incoming']);

const BackupBody = z.object({
  version: z.literal(1),
  accounts: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      currency: z.string(),
      openingBalance: z.string(),
      openingDate: z.string(),
    }),
  ),
  categories: z.array(
    z.object({
      name: z.string(),
      kind: categoryKind,
      color: z.string().nullable().optional(),
      parent: z.string().nullable().optional(),
      isDefault: z.boolean(),
    }),
  ),
  accountFilenamePatterns: z.array(
    z.object({
      pattern: z.string(),
      account: z.string().nullable(),
      priority: z.number().int(),
    }),
  ),
  rules: z.array(
    z.object({
      keyword: z.string(),
      category: z.string().nullable(),
      signConstraint,
      matchMode,
      priority: z.number().int(),
      enabled: z.boolean(),
    }),
  ),
  transferRules: z.array(
    z.object({
      keyword: z.string(),
      direction: transferDirection,
      counterpartAccount: z.string().nullable().optional(),
      enabled: z.boolean(),
    }),
  ),
  transactions: z.array(
    z.object({
      account: z.string(),
      date: z.string(),
      amount: z.string(),
      rawLabel: z.string(),
      normalizedLabel: z.string(),
      memo: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
      fitid: z.string().nullable().optional(),
      dedupKey: z.string(),
      category: z.string().nullable().optional(),
      categorySource,
      transferGroupId: z.string().nullable().optional(),
    }),
  ),
});

export async function backupRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  // ---------------------------------------------------------------------------
  // Export — emits a portable JSON dump that uses *natural keys* (account /
  // category names) instead of numeric ids. This makes the file resilient to
  // wipe + restore on the same instance, and also portable to a fresh instance.
  // ---------------------------------------------------------------------------
  app.get('/api/backup/export', async (_req, reply) => {
    const [accs, cats, patterns, rls, trls, txs] = await Promise.all([
      db.select().from(accounts),
      db.select().from(categories),
      db.select().from(accountFilenamePatterns),
      db.select().from(rules),
      db.select().from(transferRules),
      db.select().from(transactions),
    ]);

    const accountById = new Map(accs.map((a) => [a.id, a]));
    const categoryById = new Map(cats.map((c) => [c.id, c]));

    const dump = {
      version: VERSION,
      exportedAt: new Date().toISOString(),
      instance: 'athena-accounting',
      counts: {
        accounts: accs.length,
        categories: cats.length,
        rules: rls.length,
        transferRules: trls.length,
        transactions: txs.length,
        accountFilenamePatterns: patterns.length,
      },
      accounts: accs.map((a) => ({
        name: a.name,
        type: a.type,
        currency: a.currency,
        openingBalance: a.openingBalance,
        openingDate: a.openingDate,
      })),
      categories: cats.map((c) => ({
        name: c.name,
        kind: c.kind,
        color: c.color,
        parent: c.parentId ? categoryById.get(c.parentId)?.name ?? null : null,
        isDefault: c.isDefault,
      })),
      accountFilenamePatterns: patterns.map((p) => ({
        pattern: p.pattern,
        account: accountById.get(p.accountId)?.name ?? null,
        priority: p.priority,
      })),
      rules: rls.map((r) => ({
        keyword: r.keyword,
        category: categoryById.get(r.categoryId)?.name ?? null,
        signConstraint: r.signConstraint,
        matchMode: r.matchMode,
        priority: r.priority,
        enabled: r.enabled,
      })),
      transferRules: trls.map((r) => ({
        keyword: r.keyword,
        direction: r.direction,
        counterpartAccount: r.counterpartAccountId
          ? accountById.get(r.counterpartAccountId)?.name ?? null
          : null,
        enabled: r.enabled,
      })),
      transactions: txs.map((t) => ({
        account: accountById.get(t.accountId)?.name ?? null,
        date: t.date,
        amount: t.amount,
        rawLabel: t.rawLabel,
        normalizedLabel: t.normalizedLabel,
        memo: t.memo,
        notes: t.notes,
        fitid: t.fitid,
        dedupKey: t.dedupKey,
        category: t.categoryId ? categoryById.get(t.categoryId)?.name ?? null : null,
        categorySource: t.categorySource,
        transferGroupId: t.transferGroupId,
      })),
    };

    const today = new Date().toISOString().slice(0, 10);
    reply.header('Content-Type', 'application/json; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="athena-backup-${today}.json"`);
    return dump;
  });

  // ---------------------------------------------------------------------------
  // Import — REPLACE semantics. Wipes the database (within a single
  // transaction) and reinserts every row from the dump. If anything fails the
  // whole thing rolls back, so a botched import never leaves the user in a
  // half-restored state.
  // ---------------------------------------------------------------------------
  app.post('/api/backup/import', {
    // A year of transactions easily exceeds Fastify's 1 MiB default. 50 MiB
    // is generous enough for a multi-year personal accounting history.
    bodyLimit: 50 * 1024 * 1024,
  }, async (req, reply) => {
    const parsed = BackupBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid backup format',
        issues: parsed.error.issues,
      });
    }
    const dump = parsed.data;

    const result = await db.transaction(async (tx) => {
      // Wipe in reverse dependency order. file_imports references accounts;
      // transactions reference accounts + categories + file_imports.
      await tx.delete(transactions);
      await tx.delete(fileImports);
      await tx.delete(rules);
      await tx.delete(transferRules);
      await tx.delete(accountFilenamePatterns);
      await tx.delete(categories); // self-FK is ON DELETE SET NULL so cascades cleanly
      await tx.delete(accounts);

      // Accounts — keep a name -> id map for the FK resolutions below.
      const accountIdByName = new Map<string, number>();
      for (const a of dump.accounts) {
        const [inserted] = await tx
          .insert(accounts)
          .values({
            name: a.name,
            type: a.type,
            currency: a.currency,
            openingBalance: a.openingBalance,
            openingDate: a.openingDate,
          })
          .returning({ id: accounts.id });
        if (inserted) accountIdByName.set(a.name, inserted.id);
      }

      // Categories — pass 1 without parent (forward references are common in
      // a hierarchical setup), then pass 2 to wire parent_id.
      const categoryIdByName = new Map<string, number>();
      let defaultId: number | null = null;
      for (const c of dump.categories) {
        const [inserted] = await tx
          .insert(categories)
          .values({
            name: c.name,
            kind: c.kind,
            color: c.color ?? null,
            parentId: null,
            isDefault: c.isDefault,
          })
          .returning({ id: categories.id });
        if (inserted) {
          categoryIdByName.set(c.name, inserted.id);
          if (c.isDefault) defaultId = inserted.id;
        }
      }
      for (const c of dump.categories) {
        if (c.parent) {
          const childId = categoryIdByName.get(c.name);
          const parentId = categoryIdByName.get(c.parent);
          if (childId && parentId) {
            await tx
              .update(categories)
              .set({ parentId })
              .where(eq(categories.id, childId));
          }
        }
      }
      // Make sure a default "Divers" category exists — the rule engine relies
      // on it as a fallback.
      if (defaultId === null) {
        const [inserted] = await tx
          .insert(categories)
          .values({ name: 'Divers', kind: 'neutral', isDefault: true })
          .returning({ id: categories.id });
        if (inserted) {
          defaultId = inserted.id;
          categoryIdByName.set('Divers', inserted.id);
        }
      }

      // Filename patterns
      for (const p of dump.accountFilenamePatterns) {
        const accId = p.account ? accountIdByName.get(p.account) : undefined;
        if (!accId) continue;
        await tx.insert(accountFilenamePatterns).values({
          pattern: p.pattern,
          accountId: accId,
          priority: p.priority,
        });
      }

      // Rules — skip any that point at a category we couldn't resolve.
      let rulesInserted = 0;
      for (const r of dump.rules) {
        const catId = r.category ? categoryIdByName.get(r.category) : undefined;
        if (!catId) continue;
        await tx.insert(rules).values({
          keyword: r.keyword,
          categoryId: catId,
          signConstraint: r.signConstraint,
          matchMode: r.matchMode,
          priority: r.priority,
          enabled: r.enabled,
        });
        rulesInserted++;
      }

      // Transfer rules — counterpart is optional.
      for (const r of dump.transferRules) {
        const counterpartId = r.counterpartAccount
          ? accountIdByName.get(r.counterpartAccount)
          : undefined;
        await tx.insert(transferRules).values({
          keyword: r.keyword,
          direction: r.direction,
          counterpartAccountId: counterpartId ?? null,
          enabled: r.enabled,
        });
      }

      // Transactions — drop any that point at an unknown account (we don't
      // want orphan rows). categoryId can be null safely.
      let txCount = 0;
      for (const t of dump.transactions) {
        const accId = accountIdByName.get(t.account);
        if (!accId) continue;
        const catId = t.category ? categoryIdByName.get(t.category) ?? null : null;
        await tx.insert(transactions).values({
          accountId: accId,
          date: t.date,
          amount: t.amount,
          rawLabel: t.rawLabel,
          normalizedLabel: t.normalizedLabel,
          memo: t.memo ?? null,
          notes: t.notes ?? null,
          fitid: t.fitid ?? null,
          dedupKey: t.dedupKey,
          categoryId: catId,
          categorySource: t.categorySource,
          transferGroupId: t.transferGroupId ?? null,
        });
        txCount++;
      }

      return {
        imported: {
          accounts: accountIdByName.size,
          categories: categoryIdByName.size,
          accountFilenamePatterns: dump.accountFilenamePatterns.length,
          rules: rulesInserted,
          transferRules: dump.transferRules.length,
          transactions: txCount,
        },
      };
    });

    return reply.code(200).send(result);
  });
}
