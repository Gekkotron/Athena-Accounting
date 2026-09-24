import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { pdfImportDrafts } from '../../db/schema.js';
import { applyTemplateAndImport, previewTemplate } from '../../domain/imports/pdf/index.js';
import type { TemplateZones } from '../../domain/imports/pdf/zones.js';
import { userId } from '../plugins/auth.js';
import { flushSnapshots } from '../../db/snapshotScheduler.js';
import { errCode, errMessage } from './imports-errors.js';

// PDF template + draft endpoints. Extracted from imports.ts (which sits at
// the max-lines cap). Owns the "user has retrained a template" and "poll
// OCR" flows; the initial PDF import that produces a draft still lives in
// imports.ts under POST /api/imports.
export async function importsPdfRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

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
}
