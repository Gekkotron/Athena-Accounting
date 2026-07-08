import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../../env.js';
import {
  masterKey, unwrapKey, decryptEnvelope, encryptEnvelope,
} from '../../../domain/mcp/crypto.js';
import { getMcpByUsername } from '../../../domain/mcp/store.js';
import { buildOp, UnknownOpError } from './ops.js';

const Envelope = z.object({
  user: z.string().min(1),
  v: z.literal(1),
  nonce: z.string().min(1),
  ct: z.string().min(1),
});
const Inner = z.object({
  op: z.string().min(1),
  args: z.record(z.unknown()).default({}),
  ts: z.number(),
});
const SKEW_MS = 120_000;

export async function mcpRpcRoutes(app: FastifyInstance): Promise<void> {
  // Public route — it performs its own crypto auth. Dedicated rate limit.
  app.post('/api/mcp/rpc', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const env0 = Envelope.safeParse(req.body);
    if (!env0.success) return reply.code(400).send({ error: 'invalid envelope' });
    const { user, nonce, ct } = env0.data;

    const mcp = await getMcpByUsername(user);
    if (!mcp || !mcp.enabled || !mcp.keyWrapped) {
      return reply.code(401).send({ error: 'mcp access unavailable' });
    }

    let key: Buffer;
    let inner: z.infer<typeof Inner>;
    try {
      key = unwrapKey(masterKey(env.SESSION_SECRET), mcp.keyWrapped);
      const plaintext = decryptEnvelope(key, `athena-mcp-v1|${user}|req`, nonce, ct);
      const parsed = Inner.safeParse(JSON.parse(plaintext));
      if (!parsed.success) return reply.code(400).send({ error: 'invalid request' });
      inner = parsed.data;
    } catch {
      // Tag failure / wrong key / malformed ciphertext — do not distinguish.
      return reply.code(401).send({ error: 'authentication failed' });
    }

    if (Math.abs(Date.now() - inner.ts) > SKEW_MS) {
      return reply.code(401).send({ error: 'stale request' });
    }

    // From here, respond ENCRYPTED — including operation-level errors.
    const respond = (status: number, body: unknown) => {
      const out = encryptEnvelope(key, `athena-mcp-v1|${user}|res`, JSON.stringify({ status, body }));
      return reply.code(200).send({ v: 1, nonce: out.nonce, ct: out.ct });
    };

    let built;
    try {
      built = buildOp(inner.op, inner.args);
    } catch (err) {
      if (err instanceof UnknownOpError) return respond(400, { error: err.message });
      throw err;
    }

    const sub = await app.inject({
      method: built.method,
      url: built.url,
      query: built.query,
      payload: built.payload as string | object | Buffer | undefined,
      headers: {
        'x-athena-internal-auth': app.internalAuthSecret,
        'x-athena-internal-uid': String(mcp.userId),
        ...(built.payload !== undefined ? { 'content-type': 'application/json' } : {}),
      },
    });

    let body: unknown;
    try { body = sub.json(); } catch { body = sub.body; }
    return respond(sub.statusCode, body);
  });
}
