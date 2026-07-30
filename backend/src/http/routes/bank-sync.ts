import type { FastifyInstance } from 'fastify';
import { createPrivateKey } from 'node:crypto';
import { z } from 'zod';
import { userId } from '../plugins/auth.js';
import {
  createEnableBankingClient,
  EnableBankingError,
} from '../../services/enable-banking/client.js';
import {
  setCredentials,
  deleteCredentials,
  getStatus,
} from '../../domain/bank-sync/store.js';

const CredentialsBody = z.object({
  applicationId: z.string().trim().min(1).max(200),
  privateKey: z.string().trim().min(1).max(20_000),
});

export async function bankSyncRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

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
    return await getStatus(userId(req));
  });

  app.delete('/api/bank-sync/credentials', async (req) => {
    await deleteCredentials(userId(req));
    return { ok: true };
  });
}
