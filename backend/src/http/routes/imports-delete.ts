import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { fileImports, transactions } from '../../db/schema.js';
import { userId } from '../plugins/auth.js';
import { resetSyncBaseline } from '../../domain/imports/bank-sync.js';

// Cascading delete: removes the file_imports row AND every transaction whose
// source_file_id points to it. Wraps both deletes in a single transaction so
// a partial failure can't leave orphan transactions with a dangling FK.
// Extracted from imports.ts (which sits at the max-lines cap).
export async function importsDeleteRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

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
        .returning({ id: fileImports.id, format: fileImports.format, accountId: fileImports.accountId });
      // Undoing a bank-sync batch must also reset the sync baseline, else the
      // next sync resumes from lastSyncedAt and skips the deleted window.
      const fi = fiDeleted[0];
      if (fi?.format === 'bank-sync' && fi.accountId !== null) {
        await resetSyncBaseline(tx, uid, fi.accountId);
      }
      return { transactions: txDeleted.length, fileImport: fiDeleted.length };
    });
    if (result.fileImport === 0) return reply.code(404).send({ error: 'not found' });
    return reply.code(200).send({ deleted: result });
  });
}
