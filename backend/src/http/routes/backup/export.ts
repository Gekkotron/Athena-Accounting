import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { userId } from '../../plugins/auth.js';
import { buildDump, backupFilename } from '../../../domain/backup/dump.js';
import { encryptEnvelope } from './crypto.js';

const EncryptBody = z.object({ passphrase: z.string().min(8).max(1024) });

export function registerExportRoute(app: FastifyInstance): void {
  // Plaintext export was removed (2026-07) — backups are always encrypted
  // now. 410 (not 404) so old clients/bookmarks get an explanation.
  app.get('/api/backup/export', async (_req, reply) => {
    return reply.code(410).send({
      error: 'plaintext export removed — POST with a passphrase',
    });
  });

  // Same dump, sealed with AES-256-GCM under a scrypt-derived key. POST
  // (not a GET query param) so the passphrase travels in the body and never
  // lands in access logs or browser history.
  app.post('/api/backup/export', async (req, reply) => {
    const parsed = EncryptBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const dump = await buildDump(userId(req));
    const envelope = encryptEnvelope(JSON.stringify(dump), parsed.data.passphrase);
    reply.header('Content-Type', 'application/json; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${backupFilename(new Date())}"`);
    return envelope;
  });
}
