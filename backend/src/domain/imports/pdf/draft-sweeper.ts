import type { FastifyInstance } from 'fastify';
import { lt } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { pdfImportDrafts } from '../../../db/schema.js';

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export async function sweepExpiredDrafts(): Promise<number> {
  const deleted = await db
    .delete(pdfImportDrafts)
    .where(lt(pdfImportDrafts.expiresAt, new Date()))
    .returning({ id: pdfImportDrafts.id });
  return deleted.length;
}

export function startDraftSweeper(app: FastifyInstance): void {
  void sweepExpiredDrafts().catch((err) => app.log.error({ err }, 'pdf draft sweep failed'));
  const handle = setInterval(() => {
    void sweepExpiredDrafts().catch((err) => app.log.error({ err }, 'pdf draft sweep failed'));
  }, SWEEP_INTERVAL_MS);
  handle.unref();
  app.addHook('onClose', async () => clearInterval(handle));
}
