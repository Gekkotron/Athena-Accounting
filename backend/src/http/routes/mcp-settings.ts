import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { env } from '../../env.js';
import { userId } from '../plugins/auth.js';
import { getMcpState, setMcpEnabled, setMcpWrappedKey } from '../../domain/mcp/store.js';
import { masterKey, deriveContentKey, wrapKey } from '../../domain/mcp/crypto.js';

const EnableBody = z.object({ enabled: z.boolean() });

export async function mcpSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.get('/api/settings/mcp', async (req) => {
    return await getMcpState(userId(req));
  });

  app.put('/api/settings/mcp', async (req, reply) => {
    const parsed = EnableBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    await setMcpEnabled(userId(req), parsed.data.enabled);
    return await getMcpState(userId(req));
  });

  // Generate a fresh token: derive the content key, wrap it under the
  // SESSION_SECRET-derived master key, store the wrapped key, and return the
  // plaintext token ONCE. Regeneration overwrites the previous wrapped key.
  app.post('/api/settings/mcp/token', async (req, reply) => {
    const token = randomBytes(32).toString('base64url');
    const k = deriveContentKey(Buffer.from(token, 'base64url'));
    const wrapped = wrapKey(masterKey(env.SESSION_SECRET), k);
    await setMcpWrappedKey(userId(req), wrapped);
    return reply.code(201).send({ token });
  });

  app.delete('/api/settings/mcp/token', async (req) => {
    await setMcpWrappedKey(userId(req), null);
    return { ok: true };
  });
}
