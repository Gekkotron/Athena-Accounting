import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, between, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { accounts, transactions, pdfStatementTemplates } from '../../db/schema.js';
import { userId } from '../plugins/auth.js';
import { extractText } from '../../domain/imports/pdf/text-extract.js';
import { fingerprintHeader } from '../../domain/imports/pdf/fingerprint.js';
import { parseStatementRows } from '../../domain/imports/pdf/parse-rows.js';
import type { TemplateZones } from '../../domain/imports/pdf/zones.js';
import { normalizeLabel } from '../../domain/imports/normalize.js';
import { computeDedupKey } from '../../domain/imports/dedup.js';
import { reconcile, renderReconcileSummary, type StatementLine, type ExistingTx } from '../../domain/reconcile/reconcile.js';

const PDF_MAX_BYTES = 10 * 1024 * 1024;

const Body = z.object({
  pdfBase64: z.string().min(1),
  accountId: z.number().int().positive(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function reconcileRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.post('/api/reconcile', async (req, reply) => {
    const uid = userId(req);
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    const { pdfBase64, accountId, fromDate, toDate } = parsed.data;

    const [acc] = await db.select({ id: accounts.id, name: accounts.name })
      .from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.userId, uid)));
    if (!acc) return reply.code(400).send({ error: 'account not found' });

    const buffer = Buffer.from(pdfBase64, 'base64');
    if (buffer.byteLength > PDF_MAX_BYTES) return reply.code(413).send({ error: 'PDF exceeds 10MB limit' });

    let pages;
    try {
      pages = await extractText(buffer);
    } catch (err: any) {
      if (err?.code === 'pdf_encrypted') return reply.code(400).send({ code: 'pdf_encrypted', error: 'PDF is password-protected' });
      return reply.code(400).send({ error: 'could not read PDF', message: err instanceof Error ? err.message : String(err) });
    }
    if (pages.every((p) => p.items.length === 0)) {
      return reply.code(422).send({ code: 'needs_template', reason: 'no_text_layer', error: 'PDF has no text layer; set up a template via Athena import first' });
    }
    const fingerprint = fingerprintHeader(pages[0]!);
    const [tpl] = await db.select().from(pdfStatementTemplates)
      .where(and(eq(pdfStatementTemplates.fingerprint, fingerprint), eq(pdfStatementTemplates.accountId, accountId)));
    if (!tpl) {
      return reply.code(422).send({ code: 'needs_template', reason: 'no_template', error: 'no saved template for this statement + account; import it once in Athena first' });
    }
    const rowsRes = parseStatementRows(pages, tpl.zones as TemplateZones);
    if (rowsRes.kind === 'stale') {
      return reply.code(422).send({ code: 'needs_template', reason: 'template_stale', error: 'saved template no longer matches this PDF; re-train it via Athena import' });
    }

    const statement: StatementLine[] = rowsRes.rows.map((r) => {
      const normalizedLabel = normalizeLabel(r.rawLabel);
      return {
        date: r.date, amount: r.amount, rawLabel: r.rawLabel, normalizedLabel,
        dedupKey: computeDedupKey({ accountId, date: r.date, amount: r.amount, normalizedLabel, fitid: r.fitid }),
      };
    });

    const dates = statement.map((s) => s.date).sort();
    const from = fromDate ?? dates[0] ?? '0000-01-01';
    const to = toDate ?? dates[dates.length - 1] ?? '9999-12-31';

    const rows = await db.select({
      id: transactions.id, date: transactions.date, amount: transactions.amount,
      rawLabel: transactions.rawLabel, normalizedLabel: transactions.normalizedLabel,
      dedupKey: transactions.dedupKey, transferGroupId: transactions.transferGroupId,
    }).from(transactions)
      .where(and(eq(transactions.userId, uid), eq(transactions.accountId, accountId), between(transactions.date, from, to)));
    const existing: ExistingTx[] = rows.map((r) => ({ ...r }));

    const report = reconcile(statement, existing, { dateToleranceDays: 3, from, to });
    return { account: { id: acc.id, name: acc.name }, ...report, summaryText: renderReconcileSummary(report, acc.name) };
  });
}
