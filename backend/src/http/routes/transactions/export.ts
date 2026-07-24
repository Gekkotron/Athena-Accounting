import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { accounts, categories, transactions } from '../../../db/schema.js';
import { userId } from '../../plugins/auth.js';
import { ListQuery } from './schemas.js';
import { buildListWhere } from './filters.js';

// Quote per RFC 4180, with ';' added to the trigger set since the separator
// is a semicolon (Excel-FR convention).
function csvField(value: string): string {
  if (/[;"\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

// "-42.30" → "-42,30" — comma decimals so Excel-FR reads the column as a
// number instead of a date-ish string.
function csvAmount(amount: string): string {
  return amount.replace('.', ',');
}

const HEADER = ['Date', 'Compte', 'Libellé', 'Catégorie', 'Montant', 'Notes'];

export function registerExport(app: FastifyInstance): void {
  // Same query contract as GET /api/transactions minus pagination — the
  // export always covers every row the current filter matches, so what the
  // user downloads is exactly the on-screen view without its page boundary.
  app.get('/api/transactions/export', async (req, reply) => {
    const uid = userId(req);
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid query', issues: parsed.error.issues });
    }
    const q = parsed.data;

    const dir = q.order === 'asc' ? asc : desc;
    const orderCol =
      q.sort === 'amount' ? transactions.amount :
      q.sort === 'label'  ? transactions.normalizedLabel :
                            transactions.date;
    const rows = await db
      .select({
        date: transactions.date,
        amount: transactions.amount,
        rawLabel: transactions.rawLabel,
        categoryId: transactions.categoryId,
        accountId: transactions.accountId,
        notes: transactions.notes,
      })
      .from(transactions)
      .where(and(...buildListWhere(uid, q)))
      .orderBy(dir(orderCol), dir(transactions.id));

    const accountRows = await db
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(eq(accounts.userId, uid));
    const accountName = new Map(accountRows.map((a) => [a.id, a.name]));

    const catRows = await db
      .select({ id: categories.id, name: categories.name, parentId: categories.parentId })
      .from(categories)
      .where(eq(categories.userId, uid));
    const catById = new Map(catRows.map((c) => [c.id, c]));
    const categoryPath = (id: number | null): string => {
      if (id === null) return '';
      const c = catById.get(id);
      if (!c) return '';
      const parent = c.parentId !== null ? catById.get(c.parentId) : undefined;
      return parent ? `${parent.name} › ${c.name}` : c.name;
    };

    const lines = [HEADER.join(';')];
    for (const r of rows) {
      lines.push([
        r.date,
        csvField(accountName.get(r.accountId) ?? ''),
        csvField(r.rawLabel),
        csvField(categoryPath(r.categoryId)),
        csvAmount(r.amount),
        csvField(r.notes ?? ''),
      ].join(';'));
    }
    // BOM so Excel detects UTF-8 instead of guessing a legacy codepage.
    const csv = '\uFEFF' + lines.join('\r\n') + '\r\n';

    const stamp = new Date().toISOString().slice(0, 10);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="transactions-${stamp}.csv"`)
      .send(csv);
  });
}
