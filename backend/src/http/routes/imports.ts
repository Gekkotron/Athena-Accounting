import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { fileImports } from '../../db/schema.js';
import {
  inferFormat,
  resolveAccountFromFilename,
  runImport,
} from '../../domain/imports/import-service.js';
import { importPdf, applyTemplateAndImport } from '../../domain/imports/pdf/index.js';
import type { TemplateZones } from '../../domain/imports/pdf/zones.js';

const PDF_MAX_BYTES = 10 * 1024 * 1024;

export async function importsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.post('/api/imports', async (req, reply) => {
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
      accountId = await resolveAccountFromFilename(filename);
    }
    if (!accountId) {
      return reply.code(400).send({
        error: 'cannot determine target account; pass ?accountId=N or configure a filename pattern',
      });
    }

    if (format === 'pdf') {
      if (buffer.byteLength > PDF_MAX_BYTES) {
        return reply.code(413).send({ code: 'pdf_too_large', error: 'PDF exceeds 10MB limit' });
      }
      try {
        const r = await importPdf({ filename, accountId, buffer });
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
      const result = await runImport({ filename, accountId, format, buffer });
      return reply.code(201).send(result);
    } catch (err) {
      app.log.error({ err, filename }, 'import failed');
      return reply.code(400).send({ error: 'import failed', message: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/imports/pdf/templates', async (req, reply) => {
    const body = req.body as { draftId?: number; label?: string; zones?: TemplateZones };
    if (!body?.draftId || !body.label || !body.zones) {
      return reply.code(400).send({ error: 'draftId, label, and zones are required' });
    }
    try {
      const r = await applyTemplateAndImport({ draftId: body.draftId, label: body.label, zones: body.zones });
      return reply.code(201).send(r);
    } catch (err: any) {
      if (err?.code === 'draft_expired') return reply.code(410).send({ code: 'draft_expired', error: 'draft expired or not found' });
      if (err?.code === 'template_yielded_no_rows') return reply.code(422).send({ code: 'template_yielded_no_rows', error: 'zones produced 0 rows' });
      app.log.error({ err }, 'apply template failed');
      return reply.code(400).send({ error: 'apply template failed', message: err?.message ?? String(err) });
    }
  });

  app.get('/api/imports', async () => {
    const rows = await db.select().from(fileImports).orderBy(desc(fileImports.importedAt)).limit(100);
    return { imports: rows };
  });

  app.get('/api/imports/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'invalid id' });
    const [row] = await db.select().from(fileImports).where(eq(fileImports.id, id));
    if (!row) return reply.code(404).send({ error: 'not found' });
    return { fileImport: row };
  });
}
