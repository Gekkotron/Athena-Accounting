import type { FastifyInstance } from 'fastify';
import { createPrivateKey } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../../db/client.js';
import { bankConnections, bankConnectionAccounts, userSettings } from '../../../db/schema.js';
import { env } from '../../../env.js';
import { userId } from '../../plugins/auth.js';
import {
  createEnableBankingClient,
  EnableBankingError,
} from '../../../services/enable-banking/client.js';
import { setCredentials, deleteCredentials, getStatus } from '../../../domain/bank-sync/store.js';
import { nextScheduledOccurrence } from '../../../domain/imports/bank-sync-core.js';
import { mergeSettings } from '../../../domain/settings/schema.js';

// Auto-sync block of GET /api/bank-sync/status: the configured hour (from
// user settings), whether the scheduler is active at all (BANK_SYNC_AUTO),
// the newest lastSyncedAt across the user's mapped accounts (previous
// fetch), and the next scheduled occurrence (server-local clock).
async function autoSyncInfo(uid: number): Promise<{
  enabled: boolean;
  hour: number;
  lastSyncedAt: string | null;
  nextAt: string | null;
}> {
  const [row] = await db
    .select({ settings: userSettings.settings })
    .from(userSettings)
    .where(eq(userSettings.userId, uid));
  const hour = mergeSettings(row?.settings ?? {}).bankSyncHour;
  const [last] = await db
    .select({ last: sql<Date | null>`max(${bankConnectionAccounts.lastSyncedAt})` })
    .from(bankConnectionAccounts)
    .where(
      inArray(
        bankConnectionAccounts.connectionId,
        db.select({ id: bankConnections.id }).from(bankConnections).where(eq(bankConnections.userId, uid)),
      ),
    );
  const enabled = env.BANK_SYNC_AUTO;
  const lastSyncedAt = last?.last ? new Date(last.last).toISOString() : null;
  return {
    enabled,
    hour,
    lastSyncedAt,
    nextAt: enabled ? nextScheduledOccurrence(hour, new Date()).toISOString() : null,
  };
}

const CredentialsBody = z.object({
  applicationId: z.string().trim().min(1).max(200),
  privateKey: z.string().trim().min(1).max(20_000),
});

export function registerCredentials(app: FastifyInstance): void {
  // Store (or replace) the user's Enable Banking application credentials.
  // The pair is validated live against GET /application before persisting so
  // a typo'd key or a deactivated application is rejected up front.
  app.put('/api/bank-sync/credentials', async (req, reply) => {
    const uid = userId(req);
    const parsed = CredentialsBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const { applicationId, privateKey } = parsed.data;

    try {
      createPrivateKey(privateKey);
    } catch {
      return reply.code(400).send({ error: 'invalid private key' });
    }

    const client = createEnableBankingClient({ applicationId, privateKey });
    try {
      await client.getApplication();
    } catch (err) {
      if (err instanceof EnableBankingError) {
        return reply
          .code(502)
          .send({ error: 'enable banking rejected credentials', upstreamStatus: err.status });
      }
      throw err;
    }

    await setCredentials(uid, applicationId, privateKey);
    return { configured: true, applicationId };
  });

  app.get('/api/bank-sync/status', async (req) => {
    const uid = userId(req);
    const base = await getStatus(uid);
    return { ...base, autoSync: await autoSyncInfo(uid) };
  });

  app.delete('/api/bank-sync/credentials', async (req) => {
    await deleteCredentials(userId(req));
    return { ok: true };
  });
}
