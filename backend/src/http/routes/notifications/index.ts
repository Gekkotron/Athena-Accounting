import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../../db/client.js';
import { accounts, categories, notifications } from '../../../db/schema.js';
import { userId } from '../../plugins/auth.js';
import { emitNotification } from '../../../domain/notifications/emit.js';
import { renderFullDetail } from '../../../domain/notifications/render.js';
import type { Notification, NotificationPayload } from '../../../domain/notifications/types.js';

const listQuery = z.object({
  unread: z.enum(['1']).optional(),
  kind: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.coerce.number().int().optional(),
});

const testBody = z.object({
  kind: z.enum(['big_transaction', 'account_low', 'envelope_exceeded', 'bank_sync_failed']).optional(),
}).default({});

// Canned payloads for the "Send a test" button. Fake but plausible so the
// user can see what each trigger looks like without waiting for a real event.
// A test bypasses the per-trigger gate: seeing a preview shouldn't require
// enabling the trigger first — the master toggle still gates.
//
// Resolves the user's first real account and category so the preview reads
// "on Compte Courant at Amazon" instead of "on account #0 at Amazon". If
// the user has no account/category yet (fresh onboarding), fall back to a
// plausible placeholder name — never leave `#0` in the rendered body.
async function sampleTestPayload(
  uid: number,
  kind: NonNullable<z.infer<typeof testBody>['kind']>,
): Promise<NotificationPayload> {
  const [firstAccount] = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(eq(accounts.userId, uid))
    .orderBy(accounts.displayOrder, accounts.id)
    .limit(1);
  const [firstCategory] = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.userId, uid))
    .orderBy(categories.id)
    .limit(1);
  const acct = firstAccount ?? { id: 0, name: 'your account' };
  const cat  = firstCategory ?? { id: 0, name: 'your category' };
  switch (kind) {
    case 'big_transaction':
      return { kind, single: { txId: 0, accountId: acct.id, accountName: acct.name, amount: 249.99, merchant: 'Amazon' } };
    case 'account_low':
      return { kind, accountId: acct.id, accountName: acct.name, balance: 42.5, floor: 100 };
    case 'envelope_exceeded': {
      const now = new Date();
      const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
      return { kind, categoryId: cat.id, categoryName: cat.name, envelope: 200, spent: 227.3, month };
    }
    case 'bank_sync_failed':
      return { kind, accountId: acct.id, accountName: acct.name, reason: 'test_preview' };
  }
}

function accountRef(p: NotificationPayload): { id: number; name?: string } | null {
  switch (p.kind) {
    case 'big_transaction': {
      const r = 'single' in p ? p.single : p.summary;
      return { id: r.accountId, name: r.accountName };
    }
    case 'account_low':       return { id: p.accountId, name: p.accountName };
    case 'bank_sync_failed':  return { id: p.accountId, name: p.accountName };
    default:                  return null;
  }
}
function categoryRef(p: NotificationPayload): { id: number; name?: string } | null {
  return p.kind === 'envelope_exceeded' ? { id: p.categoryId, name: p.categoryName } : null;
}

// Legacy rows (persisted before the emit-time enrichment landed) have no
// accountName/categoryName on the payload — the renderer would print
// `account #12`. Batch-resolve the missing names for the current page in
// one query per table (scoped to userId), stamp them onto a shallow copy
// of each payload, and render from that. Rows that already have a name
// pass through untouched, and a name that no longer resolves (deleted
// account) still falls back to `#id` in the renderer.
async function enrichRowsForRender(
  uid: number,
  rows: (typeof notifications.$inferSelect)[],
): Promise<NotificationPayload[]> {
  const payloads = rows.map((r) => r.payload as NotificationPayload);
  const missingAccountIds = new Set<number>();
  const missingCategoryIds = new Set<number>();
  for (const p of payloads) {
    const a = accountRef(p);
    if (a && !a.name) missingAccountIds.add(a.id);
    const c = categoryRef(p);
    if (c && !c.name) missingCategoryIds.add(c.id);
  }
  const [accountRows, categoryRows] = await Promise.all([
    missingAccountIds.size === 0 ? Promise.resolve([]) : db
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(and(eq(accounts.userId, uid), inArray(accounts.id, [...missingAccountIds]))),
    missingCategoryIds.size === 0 ? Promise.resolve([]) : db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(and(eq(categories.userId, uid), inArray(categories.id, [...missingCategoryIds]))),
  ]);
  const accountName = new Map(accountRows.map((r) => [r.id, r.name]));
  const categoryName = new Map(categoryRows.map((r) => [r.id, r.name]));
  return payloads.map((p) => {
    switch (p.kind) {
      case 'big_transaction': {
        if ('single' in p) {
          if (p.single.accountName) return p;
          const name = accountName.get(p.single.accountId);
          return name ? { ...p, single: { ...p.single, accountName: name } } : p;
        }
        if (p.summary.accountName) return p;
        const name = accountName.get(p.summary.accountId);
        return name ? { ...p, summary: { ...p.summary, accountName: name } } : p;
      }
      case 'account_low':
      case 'bank_sync_failed': {
        if (p.accountName) return p;
        const name = accountName.get(p.accountId);
        return name ? { ...p, accountName: name } : p;
      }
      case 'envelope_exceeded': {
        if (p.categoryName) return p;
        const name = categoryName.get(p.categoryId);
        return name ? { ...p, categoryName: name } : p;
      }
      case 'test':
        return p;
    }
  });
}

function toWireWith(row: typeof notifications.$inferSelect, payload: NotificationPayload): Notification {
  const { title, body } = renderFullDetail(payload);
  return {
    id: row.id,
    kind: row.kind as Notification['kind'],
    payload,
    title, body,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function notificationsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.get('/api/notifications', async (req) => {
    const q = listQuery.parse(req.query);
    const uid = userId(req);
    const rows = await db.select().from(notifications)
      .where(and(
        eq(notifications.userId, uid),
        q.unread ? sql`${notifications.readAt} IS NULL` : sql`true`,
        q.kind   ? eq(notifications.kind, q.kind)      : sql`true`,
        q.cursor ? lt(notifications.id, q.cursor)      : sql`true`,
      ))
      .orderBy(desc(notifications.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const payloads = await enrichRowsForRender(uid, page);
    const items = page.map((r, i) => toWireWith(r, payloads[i]!));
    const nextCursor = rows.length > q.limit ? items[items.length - 1]!.id : null;
    return { items, nextCursor };
  });

  app.get('/api/notifications/unread-count', async (req) => {
    const uid = userId(req);
    const [r] = await db.select({ c: sql<number>`count(*)::int` }).from(notifications)
      .where(and(eq(notifications.userId, uid), sql`${notifications.readAt} IS NULL`));
    return { count: r?.c ?? 0 };
  });

  app.post('/api/notifications/:id/read', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad_id' });
    await db.update(notifications).set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId(req))));
    return reply.code(204).send();
  });

  app.post('/api/notifications/read-all', async (req, reply) => {
    await db.update(notifications).set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId(req)), sql`${notifications.readAt} IS NULL`));
    return reply.code(204).send();
  });

  app.delete('/api/notifications/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad_id' });
    await db.delete(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId(req))));
    return reply.code(204).send();
  });

  app.post('/api/notifications/test', async (req, reply) => {
    const parsed = testBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body' });
    const { kind } = parsed.data;
    const uid = userId(req);
    const row = kind
      ? await emitNotification(uid, kind, await sampleTestPayload(uid, kind),
          { idempotency: `test:${kind}:${Date.now()}`, bypassTriggerGate: true })
      : await emitNotification(uid, 'test', { kind: 'test' },
          { idempotency: `test:${Date.now()}` });
    if (row === null) return reply.code(422).send({ error: 'notifications_disabled' });
    return reply.code(201).send(row);
  });
}
