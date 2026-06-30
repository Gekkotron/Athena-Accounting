import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
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
import { userId } from '../plugins/auth.js';

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
      // Added later; optional so older backups that omit it still validate.
      // Missing displayOrder defaults to 0 on import.
      displayOrder: z.number().int().optional(),
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
  // Export — emits a portable JSON dump using natural keys (account / category
  // names). Multi-user safe: only the calling user's data is included.
  // ---------------------------------------------------------------------------
  app.get('/api/backup/export', async (req, reply) => {
    const uid = userId(req);
    const [accs, cats, patterns, rls, trls, txs] = await Promise.all([
      db.select().from(accounts).where(eq(accounts.userId, uid)),
      db.select().from(categories).where(eq(categories.userId, uid)),
      db.select().from(accountFilenamePatterns).where(eq(accountFilenamePatterns.userId, uid)),
      db.select().from(rules).where(eq(rules.userId, uid)),
      db.select().from(transferRules).where(eq(transferRules.userId, uid)),
      db.select().from(transactions).where(eq(transactions.userId, uid)),
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
        displayOrder: a.displayOrder,
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

    // Local-time stamp so multiple exports on the same day stay distinct in the
    // download folder. Shape: athena-backup-YYYY-MM-DD-HHMMSS.json
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp =
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
      `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    reply.header('Content-Type', 'application/json; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="athena-backup-${stamp}.json"`);
    return dump;
  });

  // ---------------------------------------------------------------------------
  // Import — REPLACE semantics, scoped to the calling user only. Wipes only
  // the caller's rows (via WHERE user_id = $uid) and reinserts every row from
  // the dump with that user_id stamped. Other users' data is untouched.
  // ---------------------------------------------------------------------------
  app.post('/api/backup/import', {
    bodyLimit: 50 * 1024 * 1024,
  }, async (req, reply) => {
    const uid = userId(req);
    const parsed = BackupBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid backup format',
        issues: parsed.error.issues,
      });
    }
    const dump = parsed.data;

    const result = await db.transaction(async (tx) => {
      // Wipe only THIS user's rows, in reverse dependency order.
      await tx.delete(transactions).where(eq(transactions.userId, uid));
      await tx.delete(fileImports).where(eq(fileImports.userId, uid));
      await tx.delete(rules).where(eq(rules.userId, uid));
      await tx.delete(transferRules).where(eq(transferRules.userId, uid));
      await tx.delete(accountFilenamePatterns).where(eq(accountFilenamePatterns.userId, uid));
      await tx.delete(categories).where(eq(categories.userId, uid));
      await tx.delete(accounts).where(eq(accounts.userId, uid));

      const accountIdByName = new Map<string, number>();
      for (const a of dump.accounts) {
        const [inserted] = await tx
          .insert(accounts)
          .values({
            userId: uid,
            name: a.name,
            type: a.type,
            currency: a.currency,
            openingBalance: a.openingBalance,
            openingDate: a.openingDate,
            displayOrder: a.displayOrder ?? 0,
          })
          .returning({ id: accounts.id });
        if (inserted) accountIdByName.set(a.name, inserted.id);
      }

      const categoryIdByName = new Map<string, number>();
      let defaultId: number | null = null;
      for (const c of dump.categories) {
        const [inserted] = await tx
          .insert(categories)
          .values({
            userId: uid,
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
              .where(and(eq(categories.id, childId), eq(categories.userId, uid)));
          }
        }
      }
      // Seed Divers if the dump didn't bring its own default.
      if (defaultId === null) {
        const [inserted] = await tx
          .insert(categories)
          .values({ userId: uid, name: 'Divers', kind: 'neutral', isDefault: true })
          .returning({ id: categories.id });
        if (inserted) {
          defaultId = inserted.id;
          categoryIdByName.set('Divers', inserted.id);
        }
      }

      for (const p of dump.accountFilenamePatterns) {
        const accId = p.account ? accountIdByName.get(p.account) : undefined;
        if (!accId) continue;
        await tx.insert(accountFilenamePatterns).values({
          userId: uid,
          pattern: p.pattern,
          accountId: accId,
          priority: p.priority,
        });
      }

      let rulesInserted = 0;
      for (const r of dump.rules) {
        const catId = r.category ? categoryIdByName.get(r.category) : undefined;
        if (!catId) continue;
        await tx.insert(rules).values({
          userId: uid,
          keyword: r.keyword,
          categoryId: catId,
          signConstraint: r.signConstraint,
          matchMode: r.matchMode,
          priority: r.priority,
          enabled: r.enabled,
        });
        rulesInserted++;
      }

      for (const r of dump.transferRules) {
        const counterpartId = r.counterpartAccount
          ? accountIdByName.get(r.counterpartAccount)
          : undefined;
        await tx.insert(transferRules).values({
          userId: uid,
          keyword: r.keyword,
          direction: r.direction,
          counterpartAccountId: counterpartId ?? null,
          enabled: r.enabled,
        });
      }

      let txCount = 0;
      for (const t of dump.transactions) {
        const accId = accountIdByName.get(t.account);
        if (!accId) continue;
        const catId = t.category ? categoryIdByName.get(t.category) ?? null : null;
        await tx.insert(transactions).values({
          userId: uid,
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
