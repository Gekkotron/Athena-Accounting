import type { FastifyInstance } from 'fastify';
import type { SQL } from 'drizzle-orm';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { fileImports, pdfImportDrafts } from '../../db/schema.js';
import {
  inferFormat,
  resolveAccountFromFilename,
  runImport,
} from '../../domain/imports/import-service.js';
import { importPdf, applyTemplateAndImport, previewTemplate } from '../../domain/imports/pdf/index.js';
import type { TemplateZones } from '../../domain/imports/pdf/zones.js';
import { importPhoto, PhotoTooLargeError, PhotoUnsupportedMimeError } from '../../domain/imports/photo/index.js';
import { userId } from '../plugins/auth.js';
import { flushSnapshots } from '../../db/snapshotScheduler.js';

const PDF_MAX_BYTES = 10 * 1024 * 1024;

// Narrows a caught `unknown` to its optional string `code` field —
// import errors from importPdf / applyTemplateAndImport / previewTemplate
// carry a discriminator like 'pdf_encrypted' / 'draft_expired' /
// 'template_yielded_no_rows' that the caller branches on for HTTP status.
function errCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const c = (err as { code: unknown }).code;
    if (typeof c === 'string') return c;
  }
  return undefined;
}
function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Enriched-import select: one query, one round-trip. Hydrates
// `computedBalance` per row via a correlated subquery — replaces the
// pre-refactor per-row `Promise.all(rows.map(enrichImport))` fan-out
// that serialised behind PGlite's single WASM connection and blew
// request latency on users with many imports. The scalar subquery
// returns NULL when the row has no statedBalance / statedBalanceDate
// (reconciliation not set); JS then folds `delta` from the same
// values already on the wire.
async function selectEnrichedImports(where: SQL, order: 'list' | 'single', limit = 100) {
  const computedSubquery = sql<string | null>`(
    SELECT ((a.opening_balance) + COALESCE(
      (SELECT SUM(t.amount) FROM transactions AS t
        WHERE t.account_id = a.id AND t.date <= ${fileImports.statedBalanceDate}), 0
    ))::numeric(14,2)
    FROM accounts AS a
    WHERE a.id = ${fileImports.accountId}
      AND ${fileImports.statedBalance} IS NOT NULL
      AND ${fileImports.statedBalanceDate} IS NOT NULL
  )`;
  const query = db
    .select({ fi: fileImports, computed: computedSubquery })
    .from(fileImports)
    .where(where);
  // list mode sorts by id DESC so cursor pagination on `?before=<id>` stays
  // stable (id is monotonic + unique; ties on importedAt would break a
  // (timestamp, id) cursor). single mode preserves the pre-refactor limit(1).
  const rows = order === 'list'
    ? await query.orderBy(desc(fileImports.id)).limit(limit)
    : await query.limit(1);
  return rows.map(({ fi, computed }) => {
    if (computed == null || fi.statedBalance == null) {
      return { ...fi, computedBalance: null as string | null, delta: null as string | null };
    }
    const delta = (Number(fi.statedBalance) - Number(computed)).toFixed(2);
    return { ...fi, computedBalance: computed, delta };
  });
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
      return reply.code(400).send({ error: 'unsupported file extension (expected .ofx, .qfx, .csv, .pdf, or .xml)' });
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

    let skipParsedIndices: number[] | undefined;
    const rawSkip = (data.fields as Record<string, { value?: unknown } | undefined>).skipParsedIndices?.value;
    if (typeof rawSkip === 'string' && rawSkip.trim()) {
      try {
        const parsedSkip = JSON.parse(rawSkip);
        if (Array.isArray(parsedSkip)) {
          skipParsedIndices = parsedSkip
            .map((v) => Number(v))
            .filter((n) => Number.isInteger(n) && n >= 0);
        }
      } catch {
        return reply.code(400).send({ error: 'skipParsedIndices must be a JSON array of integers' });
      }
    }

    if (format === 'pdf') {
      if (buffer.byteLength > PDF_MAX_BYTES) {
        return reply.code(413).send({ code: 'pdf_too_large', error: 'PDF exceeds 10MB limit' });
      }
      try {
        const r = await importPdf({ filename, accountId, userId: uid, buffer });
        if (r.kind === 'imported') {
          app.metrics.importsTotal.inc({ kind: 'pdf', outcome: 'success' }); void flushSnapshots();
          return reply.code(201).send(r);
        }
        return reply.code(200).send(r);
      } catch (err: unknown) {
        app.metrics.importsTotal.inc({ kind: 'pdf', outcome: 'error' });
        const code = errCode(err);
        if (code === 'pdf_encrypted') return reply.code(400).send({ code: 'pdf_encrypted', error: 'PDF is password-protected' });
        if (code === 'template_yielded_no_rows') {
          return reply.code(422).send({ code: 'template_yielded_no_rows', error: 'saved template did not match this PDF; retrain via /api/pdf-templates' });
        }
        app.log.error({ err, filename }, 'pdf import failed');
        return reply.code(400).send({ error: 'pdf import failed', message: errMessage(err) });
      }
    }

    try {
      const result = await runImport({ filename, accountId, userId: uid, format, buffer, skipParsedIndices });
      app.metrics.importsTotal.inc({ kind: format, outcome: 'success' }); void flushSnapshots();
      return reply.code(201).send(result);
    } catch (err) {
      app.metrics.importsTotal.inc({ kind: format, outcome: 'error' });
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
      app.metrics.importsTotal.inc({ kind: 'photo', outcome: 'success' }); void flushSnapshots();
      return reply.code(200).send(result);
    } catch (err) {
      app.metrics.importsTotal.inc({ kind: 'photo', outcome: 'error' });
      if (err instanceof PhotoTooLargeError) return reply.code(400).send({ error: 'photo too large (max 25 MB)' });
      if (err instanceof PhotoUnsupportedMimeError) return reply.code(400).send({ error: err.message });
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
      app.metrics.importsTotal.inc({ kind: 'pdf', outcome: 'success' }); void flushSnapshots();
      return reply.code(201).send(r);
    } catch (err: unknown) {
      app.metrics.importsTotal.inc({ kind: 'pdf', outcome: 'error' });
      const code = errCode(err);
      if (code === 'draft_expired') return reply.code(410).send({ code: 'draft_expired', error: 'draft expired or not found' });
      if (code === 'template_yielded_no_rows') return reply.code(422).send({ code: 'template_yielded_no_rows', error: 'zones produced 0 rows' });
      app.log.error({ err }, 'apply template failed');
      return reply.code(400).send({ error: 'apply template failed', message: errMessage(err) });
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
    } catch (err: unknown) {
      if (errCode(err) === 'draft_expired') {
        return reply.code(410).send({ code: 'draft_expired', error: 'draft expired or not found' });
      }
      app.log.error({ err }, 'preview template failed');
      return reply.code(400).send({ error: 'preview failed', message: errMessage(err) });
    }
  });

  app.get('/api/imports', async (req, reply) => {
    const uid = userId(req);
    // Cursor pagination on id DESC. ?before=<id> pages backwards, ?limit=<n>
    // sizes a page (default 100, max 500). nextCursor = last-row id when
    // the page is full; null on the last page.
    const q = req.query as { before?: string; limit?: string };
    const parsedBefore = q.before === undefined ? null : Number(q.before);
    if (parsedBefore !== null && (!Number.isInteger(parsedBefore) || parsedBefore <= 0)) return reply.code(400).send({ error: 'before must be a positive integer id' });
    const parsedLimit = q.limit === undefined ? 100 : Number(q.limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 500) return reply.code(400).send({ error: 'limit must be an integer between 1 and 500' });
    const where = parsedBefore !== null
      ? and(eq(fileImports.userId, uid), lt(fileImports.id, parsedBefore))!
      : eq(fileImports.userId, uid);
    const imports = await selectEnrichedImports(where, 'list', parsedLimit);
    const nextCursor = imports.length === parsedLimit ? imports[imports.length - 1]!.id : null;
    return { imports, nextCursor };
  });

  app.get('/api/imports/:id', async (req, reply) => {
    const uid = userId(req);
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'invalid id' });
    const [row] = await selectEnrichedImports(and(eq(fileImports.id, id), eq(fileImports.userId, uid))!, 'single');
    if (!row) return reply.code(404).send({ error: 'not found' });
    return { fileImport: row };
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

  // Cascading delete of an import batch lives in imports-delete.ts.

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
    const [updated] = await db
      .update(fileImports)
      .set(updates)
      .where(and(eq(fileImports.id, id), eq(fileImports.userId, uid)))
      .returning({ id: fileImports.id });
    if (!updated) return reply.code(404).send({ error: 'not found' });
    const [row] = await selectEnrichedImports(
      and(eq(fileImports.id, id), eq(fileImports.userId, uid))!,
      'single',
    );
    return { fileImport: row };
  });
}
