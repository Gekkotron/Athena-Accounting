import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { fileImports } from '../../db/schema.js';
import {
  inferFormat,
  resolveAccountFromFilename,
  runImport,
} from '../../domain/imports/import-service.js';

export async function importsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.post('/api/imports', async (req, reply) => {
    const data = await req.file({ limits: { fileSize: 20 * 1024 * 1024 } });
    if (!data) return reply.code(400).send({ error: 'no file uploaded' });

    const filename = data.filename;
    const buffer = await data.toBuffer();

    const format = inferFormat(filename);
    if (!format) {
      return reply.code(400).send({ error: 'unsupported file extension (expected .ofx, .qfx, or .csv)' });
    }

    // Account selection: explicit ?accountId wins, else filename pattern match.
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

    try {
      const result = await runImport({ filename, accountId, format, buffer });
      return reply.code(201).send(result);
    } catch (err) {
      app.log.error({ err, filename }, 'import failed');
      return reply.code(400).send({
        error: 'import failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // List recent imports — useful for the UI to show what happened and to
  // explain a "nothing was added" outcome (everything was dedup-skipped).
  app.get('/api/imports', async () => {
    const rows = await db
      .select()
      .from(fileImports)
      .orderBy(desc(fileImports.importedAt))
      .limit(100);
    return { imports: rows };
  });

  app.get('/api/imports/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ error: 'invalid id' });
    }
    const [row] = await db.select().from(fileImports).where(eq(fileImports.id, id));
    if (!row) return reply.code(404).send({ error: 'not found' });
    return { fileImport: row };
  });
}
