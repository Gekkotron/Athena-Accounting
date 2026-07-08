import type {
  FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler,
} from 'fastify';
import fp from 'fastify-plugin';
import cookie from '@fastify/cookie';
import session from '@fastify/session';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../../env.js';

declare module 'fastify' {
  interface Session { userId?: number; username?: string; }
  interface FastifyInstance {
    requireAuth: preHandlerHookHandler;
    internalAuthSecret: string;
  }
  interface FastifyRequest { mcpUserId: number | null; }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export const authPlugin = fp(async function authPlugin(app: FastifyInstance) {
  await app.register(cookie);
  await app.register(session, {
    secret: env.SESSION_SECRET,
    cookieName: 'athena.sid',
    saveUninitialized: false,
    cookie: {
      secure: env.COOKIE_SECURE,
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/',
    },
  });

  // Per-process secret that only the in-process /api/mcp/rpc handler knows.
  // It lets app.inject sub-requests authenticate as a resolved user without a
  // cookie. Never persisted, logged, or sent to any external client.
  const internalAuthSecret = randomBytes(32).toString('hex');
  app.decorate('internalAuthSecret', internalAuthSecret);
  app.decorateRequest('mcpUserId', null);

  const requireAuth: preHandlerHookHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.session.userId) return;
    const secret = req.headers['x-athena-internal-auth'];
    const uidHeader = req.headers['x-athena-internal-uid'];
    if (typeof secret === 'string' && safeEqual(secret, internalAuthSecret) && typeof uidHeader === 'string') {
      const uid = Number(uidHeader);
      if (Number.isInteger(uid) && uid > 0) {
        req.mcpUserId = uid;
        return;
      }
    }
    reply.code(401).send({ error: 'authentication required' });
  };

  app.decorate('requireAuth', requireAuth);
});

export function userId(req: FastifyRequest): number {
  const id = req.session.userId ?? req.mcpUserId ?? undefined;
  if (!id) throw new Error('userId() called without an authenticated session');
  return id;
}
