import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import fp from 'fastify-plugin';
import cookie from '@fastify/cookie';
import session from '@fastify/session';
import { env } from '../../env.js';

declare module 'fastify' {
  interface Session {
    userId?: number;
    username?: string;
  }
  interface FastifyInstance {
    requireAuth: preHandlerHookHandler;
  }
}

// Wrapped in fastify-plugin so the `requireAuth` decorator and the session
// machinery are visible from the parent scope where routes are registered.
export const authPlugin = fp(async function authPlugin(app: FastifyInstance) {
  await app.register(cookie);
  await app.register(session, {
    secret: env.SESSION_SECRET,
    cookieName: 'athena.sid',
    saveUninitialized: false,
    cookie: {
      // Set secure=true behind an HTTPS reverse proxy. In LAN HTTP deployments
      // a secure cookie would never be sent → login would silently fail.
      secure: env.COOKIE_SECURE,
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      path: '/',
    },
  });

  const requireAuth: preHandlerHookHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.session.userId) {
      reply.code(401).send({ error: 'authentication required' });
    }
  };

  app.decorate('requireAuth', requireAuth);
});
