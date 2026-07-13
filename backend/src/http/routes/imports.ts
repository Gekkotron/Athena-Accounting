import type { FastifyInstance } from 'fastify';
import { and, desc, eq, lte, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { accounts, fileImports, pdfImportDrafts, transactions } from '../../db/schema.js';
import {
  inferFormat,
  resolveAccountFromFilename,
  runImport,
} from '../../domain/imports/import-service.js';
import { importPdf, applyTemplateAndImport, previewTemplate } from '../../domain/imports/pdf/index.js';
import type { TemplateZones } from '../../domain/imports/pdf/zones.js';
import { importPhoto, PhotoTooLargeError, PhotoUnsupportedMimeError } from '../../domain/imports/photo/index.js';
import { userId } from '../plugins/auth.js';

const PDF_MAX_BYTES = 10 * 1024 * 1024;

// Sum of opening_balance + every transaction up to and including `asOf`.
// Returns a "14.2"-style string so the API surface stays consistent with
// how Drizzle serializes numeric(14,2) columns elsewhere.
async function computedBalanceAt(accountId: number, asOf: string): Promise<string> {
  const [row] = await db
    .select({
      opening: accounts.openingBalance,
      sum: sql<string>`COALESCE(SUM(${transactions.amount}), 0)`.as('sum'),
    })
    .from(accounts)
    .leftJoin(
      transactions,
      and(eq(transactions.accountId, accounts.id), lte(transactions.date, asOf)),
    )
    .where(eq(accounts.id, accountId))
    .groupBy(accounts.openingBalance);
  if (!row) return '0.00';
  return (Number(row.opening) + Number(row.sum)).toFixed(2);
}

async function enrichImport(row: typeof fileImports.$inferSelect) {
  if (!row.statedBalance || !row.statedBalanceDate) {
    return { ...row, computedBalance: null as string | null, delta: null as string | null };
  }
  const computed = await computedBalanceAt(row.accountId, row.statedBalanceDate);
  const delta = (Number(row.statedBalance) - Number(computed)).toFixed(2);
  return { ...row, computedBalance: computed, delta };
}

export async function importsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.post('/api/imports', async (req, reply) => {
    if (!req.isMultipart()) return reply.code(400).send({ error: 'no file uploaded' });
    const data = await req.file({ limits: { fileSize: 20 * 1024 * 1024 } });
    if (!data) return reply.code(400).send({ error: 'no file uploaded' });
    const filename = data.filename;
    const buffer = await data.toBuffer();
    const format = inferFormat(filename);
    if (!format) {
      return reply.code(400).send({ error: 'unsupported file extension (expected .ofx, .qfx, .csv, or .pdf)' });
    }

    const q = req.query as { accountId?: string };
    let accountId: number | null = null;
    if (q.accountId) {
      const n = Number(q.accountId);
      if (!Number.isInteger(n) || n <= 0) {
        return reply.code(400).send({ error: 'invalid accountId' });
      }
      accountId = n;
    } else {
      accountId = await resolveAccountFromFilename(userId(req), filename);
    }
    if (!accountId) {
      return reply.code(400).send({
        error: 'cannot determine target account; pass ?accountId=N or configure a filename pattern',
      });
    }

    const uid = userId(req);

    if (format === 'pdf') {
      if (buffer.byteLength > PDF_MAX_BYTES) {
        return reply.code(413).send({ code: 'pdf_too_large', error: 'PDF exceeds 10MB limit' });
      }
      try {
        const r = await importPdf({ filename, accountId, userId: uid, buffer });
        if (r.kind === 'imported') return reply.code(201).send(r);
        return reply.code(200).send(r);
      } catch (err: any) {
        if (err?.code === 'pdf_encrypted') return reply.code(400).send({ code: 'pdf_encrypted', error: 'PDF is password-protected' });
        if (err?.code === 'template_yielded_no_rows') {
          return reply.code(422).send({ code: 'template_yielded_no_rows', error: 'saved template did not match this PDF; retrain via /api/pdf-templates' });
        }
        app.log.error({ err, filename }, 'pdf import failed');
        return reply.code(400).send({ error: 'pdf import failed', message: err instanceof Error ? err.message : String(err) });
      }
    }

    try {
      const result = await runImport({ filename, accountId, userId: uid, format, buffer });
      return reply.code(201).send(result);
    } catch (err) {
      app.log.error({ err, filename }, 'import failed');
      return reply.code(400).send({ error: 'import failed', message: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/imports/photo', async (req, reply) => {
    if (!req.isMultipart()) return reply.code(400).send({ error: 'no file uploaded' });
    const data = await req.file({ limits: { fileSize: 26 * 1024 * 1024 } });
    if (!data) return reply.code(400).send({ error: 'no file uploaded' });
    const filename = data.filename;
    const buffer = await data.toBuffer();
    const q = req.query as { accountId?: string };
    const accountId = q.accountId ? Number(q.accountId) : null;
    if (!accountId || !Number.isInteger(accountId) || accountId <= 0) {
      return reply.code(400).send({ error: 'invalid accountId' });
    }
    try {
      const result = await importPhoto({
        filename, accountId, userId: userId(req), buffer,
      });
      return reply.code(200).send(result);
    } catch (err) {
      if (err instanceof PhotoTooLargeError) return reply.code(400).send({ error: 'photo too large (max 25 MB)' });
      if (err instanceof PhotoUnsupportedMimeError) return reply.code(400).send({ error: 'unsupported image format' });
      app.log.error({ err, filename }, 'photo import failed');
      throw err;
    }
  });

  app.post('/api/imports/pdf/templates', async (req, reply) => {
    const body = req.body as {
      draftId?: number;
      label?: string;
      zones?: TemplateZones;
      override_rows?: Array<{ date?: string; label?: string; amount?: string }>;
    };
    if (!body?.draftId || !body.label || !body.zones) {
      return reply.code(400).send({ error: 'draftId, label, and zones are required' });
    }
    let overrideRows: Array<{ date: string; label: string; amount: string }> | undefined;
    if (body.override_rows !== undefined) {
      if (!Array.isArray(body.override_rows)) {
        return reply.code(400).send({ error: 'override_rows must be an array' });
      }
      for (const r of body.override_rows) {
        if (
          typeof r?.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) ||
          typeof r?.label !== 'string' || r.label.length < 1 || r.label.length > 200 ||
          typeof r?.amount !== 'string' || !/^-?\d+([.,]\d{1,2})?$/.test(r.amount)
        ) {
          return reply.code(400).send({ error: 'invalid override_rows entry (expected date YYYY-MM-DD, label, decimal amount)' });
        }
      }
      overrideRows = body.override_rows as Array<{ date: string; label: string; amount: string }>;
    }
    try {
      const r = await applyTemplateAndImport({
        draftId: body.draftId,
        label: body.label,
        zones: body.zones,
        overrideRows,
        userId: userId(req),
      });
      return reply.code(201).send(r);
    } catch (err: any) {
      if (err?.code === 'draft_expired') return reply.code(410).send({ code: 'draft_expired', error: 'draft expired or not found' });
      if (err?.code === 'template_yielded_no_rows') return reply.code(422).send({ code: 'template_yielded_no_rows', error: 'zones produced 0 rows' });
      app.log.error({ err }, 'apply template failed');
      return reply.code(400).send({ error: 'apply template failed', message: err?.message ?? String(err) });
    }
  });

  app.post('/api/imports/pdf/templates/preview', async (req, reply) => {
    const body = req.body as { draftId?: number; zones?: TemplateZones };
    if (!body?.draftId || !body.zones) {
      return reply.code(400).send({ error: 'draftId and zones are required' });
    }
    try {
      const r = await previewTemplate({ draftId: body.draftId, zones: body.zones, userId: userId(req) });
      return reply.code(200).send(r);
    } catch (err: any) {
      if (err?.code === 'draft_expired') {
        return reply.code(410).send({ code: 'draft_expired', error: 'draft expired or not found' });
      }
      app.log.error({ err }, 'preview template failed');
      return reply.code(400).send({ error: 'preview failed', message: err?.message ?? String(err) });
    }
  });

  app.get('/api/imports', async (req) => {
    const uid = userId(req);
    const rows = await db
      .select()
      .from(fileImports)
      .where(eq(fileImports.userId, uid))
      .orderBy(desc(fileImports.importedAt))
      .limit(100);
    const enriched = await Promise.all(rows.map(enrichImport));
    return { imports: enriched };
  });

  app.get('/api/imports/:id', async (req, reply) => {
    const uid = userId(req);
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'invalid id' });
    const [row] = await db
      .select()
      .from(fileImports)
      .where(and(eq(fileImports.id, id), eq(fileImports.userId, uid)));
    if (!row) return reply.code(404).send({ error: 'not found' });
    return { fileImport: await enrichImport(row) };
  });

  app.get('/api/imports/pdf/drafts/:id', async (req, reply) => {
    const uid = userId(req);
    const id = Number((req.params as { id?: string }).id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'invalid id' });
    const [row] = await db.select({
      id: pdfImportDrafts.id,
      userId: pdfImportDrafts.userId,
      textItems: pdfImportDrafts.textItems,
      ocrStatus: pdfImportDrafts.ocrStatus,
    }).from(pdfImportDrafts).where(eq(pdfImportDrafts.id, id));
    if (!row || row.userId !== uid) return reply.code(404).send({ error: 'not found' });
    return { textItems: row.textItems, ocrStatus: row.ocrStatus };
  });

  app.get('/api/imports/pdf/drafts/:id/ocr-status', async (req, reply) => {
    const uid = userId(req);
    const id = Number((req.params as { id?: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ error: 'invalid id' });
    }
    const [row] = await db
      .select({
        status: pdfImportDrafts.ocrStatus,
        progress: pdfImportDrafts.ocrProgress,
        total: pdfImportDrafts.ocrTotal,
        error: pdfImportDrafts.ocrError,
        userId: pdfImportDrafts.userId,
      })
      .from(pdfImportDrafts)
      .where(eq(pdfImportDrafts.id, id));
    // 404 on both "not found" and "belongs to another user" (project's
    // non-enumeration convention — matches how other draft endpoints behave).
    if (!row || row.userId !== uid) return reply.code(404).send({ error: 'not found' });
    return {
      status: row.status,
      progress: row.progress,
      total: row.total,
      error: row.error ?? undefined,
    };
  });

  // Cascading delete: removes the file_imports row AND every transaction whose
  // source_file_id points to it. Wraps both deletes in a single transaction so
  // a partial failure can't leave orphan transactions with a dangling FK.
  app.delete('/api/imports/:id', async (req, reply) => {
    const uid = userId(req);
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'invalid id' });
    const result = await db.transaction(async (tx) => {
      const txDeleted = await tx
        .delete(transactions)
        .where(and(eq(transactions.sourceFileId, id), eq(transactions.userId, uid)))
        .returning({ id: transactions.id });
      const fiDeleted = await tx
        .delete(fileImports)
        .where(and(eq(fileImports.id, id), eq(fileImports.userId, uid)))
        .returning({ id: fileImports.id });
      return { transactions: txDeleted.length, fileImport: fiDeleted.length };
    });
    if (result.fileImport === 0) return reply.code(404).send({ error: 'not found' });
    return reply.code(200).send({ deleted: result });
  });

  // Reconciliation: record the closing balance printed on a statement so the
  // app can compare it to its own computed balance. Either field may be null
  // (sent as null to clear) or a NUMERIC/DATE string.
  app.patch('/api/imports/:id', async (req, reply) => {
    const uid = userId(req);
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'invalid id' });
    const body = req.body as { statedBalance?: string | null; statedBalanceDate?: string | null };
    if (body == null || (body.statedBalance === undefined && body.statedBalanceDate === undefined)) {
      return reply.code(400).send({ error: 'statedBalance and/or statedBalanceDate required' });
    }
    const updates: Record<string, unknown> = {};
    if (body.statedBalance !== undefined) {
      if (body.statedBalance === null || body.statedBalance === '') {
        updates.statedBalance = null;
      } else {
        const n = Number(body.statedBalance);
        if (!Number.isFinite(n)) return reply.code(400).send({ error: 'statedBalance must be a number' });
        updates.statedBalance = n.toFixed(2);
      }
    }
    if (body.statedBalanceDate !== undefined) {
      if (body.statedBalanceDate === null || body.statedBalanceDate === '') {
        updates.statedBalanceDate = null;
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(body.statedBalanceDate)) {
        return reply.code(400).send({ error: 'statedBalanceDate must be YYYY-MM-DD' });
      } else {
        updates.statedBalanceDate = body.statedBalanceDate;
      }
    }
    const [row] = await db
      .update(fileImports)
      .set(updates)
      .where(and(eq(fileImports.id, id), eq(fileImports.userId, uid)))
      .returning();
    if (!row) return reply.code(404).send({ error: 'not found' });
    return { fileImport: await enrichImport(row) };
  });
}
