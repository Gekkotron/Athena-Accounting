import type { FastifyInstance } from 'fastify';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { pdfStatementTemplates } from '../../db/schema.js';
import { validateZones, type TemplateZones } from '../../domain/imports/pdf/zones.js';
import { userId } from '../plugins/auth.js';

export async function pdfTemplatesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.get('/api/pdf-templates', async (req) => {
    const uid = userId(req);
    const rows = await db
      .select({
        id: pdfStatementTemplates.id,
        fingerprint: pdfStatementTemplates.fingerprint,
        accountId: pdfStatementTemplates.accountId,
        label: pdfStatementTemplates.label,
        source: pdfStatementTemplates.source,
        createdAt: pdfStatementTemplates.createdAt,
        updatedAt: pdfStatementTemplates.updatedAt,
      })
      .from(pdfStatementTemplates)
      .where(eq(pdfStatementTemplates.userId, uid))
      .orderBy(desc(pdfStatementTemplates.updatedAt));
    return { templates: rows };
  });

  app.put('/api/pdf-templates/:id', async (req, reply) => {
    const uid = userId(req);
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'invalid id' });
    const body = req.body as { label?: string; zones?: TemplateZones };
    const updates: Record<string, unknown> = { updatedAt: sql`now()` };
    if (typeof body.label === 'string' && body.label.trim()) updates.label = body.label.trim();
    if (body.zones) {
      validateZones(body.zones);
      updates.zones = body.zones;
    }
    if (Object.keys(updates).length === 1) {
      return reply.code(400).send({ error: 'nothing to update' });
    }
    const [row] = await db
      .update(pdfStatementTemplates)
      .set(updates)
      .where(and(eq(pdfStatementTemplates.id, id), eq(pdfStatementTemplates.userId, uid)))
      .returning();
    if (!row) return reply.code(404).send({ error: 'not found' });
    return { template: row };
  });

  app.delete('/api/pdf-templates/:id', async (req, reply) => {
    const uid = userId(req);
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'invalid id' });
    const r = await db
      .delete(pdfStatementTemplates)
      .where(and(eq(pdfStatementTemplates.id, id), eq(pdfStatementTemplates.userId, uid)))
      .returning({ id: pdfStatementTemplates.id });
    if (r.length === 0) return reply.code(404).send({ error: 'not found' });
    return reply.code(204).send();
  });
}
