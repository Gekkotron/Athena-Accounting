import type { FastifyInstance } from 'fastify';
import { inferFormat, resolveAccountFromFilename } from '../../domain/imports/import-service.js';
import { previewImport } from '../../domain/imports/preview-service.js';
import { userId } from '../plugins/auth.js';

export async function importsPreviewRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.post('/api/imports/preview', async (req, reply) => {
    if (!req.isMultipart()) return reply.code(400).send({ error: 'no file uploaded' });
    const data = await req.file({ limits: { fileSize: 20 * 1024 * 1024 } });
    if (!data) return reply.code(400).send({ error: 'no file uploaded' });
    const filename = data.filename;
    const buffer = await data.toBuffer();
    const format = inferFormat(filename);
    if (!format) {
      return reply.code(400).send({ error: 'unsupported file extension (expected .ofx, .qfx, .csv, or .pdf)' });
    }
    if (format === 'pdf') {
      return reply.code(400).send({ error: 'preview not supported for PDF, use the template wizard' });
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

    try {
      const result = await previewImport({
        filename, accountId, userId: userId(req), format, buffer,
      });
      return reply.code(200).send(result);
    } catch (err) {
      app.log.error({ err, filename }, 'preview failed');
      return reply.code(400).send({
        error: 'preview failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
