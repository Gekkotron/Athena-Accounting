import type { FastifyInstance } from 'fastify';
import { lt } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { pdfImportDrafts } from '../../../db/schema.js';

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export async function sweepExpiredDrafts(
  onAborted?: (count: number) => void,
): Promise<number> {
  const deleted = await db
    .delete(pdfImportDrafts)
    .where(lt(pdfImportDrafts.expiresAt, new Date()))
    .returning({ id: pdfImportDrafts.id });
  const n = deleted.length;
  if (n > 0 && onAborted) onAborted(n);
  return n;
}

export function startDraftSweeper(app: FastifyInstance): void {
  const bumpMetric = (n: number) => {
    if ((app as { metrics?: { importsTotal?: { inc: (l: { kind: string; outcome: string }, v: number) => void } } }).metrics?.importsTotal) {
      app.metrics.importsTotal.inc({ kind: 'pdf', outcome: 'aborted' }, n);
    }
  };
  void sweepExpiredDrafts(bumpMetric).catch((err) => app.log.error({ err }, 'pdf draft sweep failed'));
  const handle = setInterval(() => {
    void sweepExpiredDrafts(bumpMetric).catch((err) => app.log.error({ err }, 'pdf draft sweep failed'));
  }, SWEEP_INTERVAL_MS);
  handle.unref();
  app.addHook('onClose', async () => clearInterval(handle));
}
