import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import session from '@fastify/session';
import { createSessionStore, rotateSession } from '../session-store.js';

declare module 'fastify' {
  interface Session { userId?: number }
}

// Regression for a logout that silently undid itself: @fastify/session's
// default `rolling: true` re-saves the session on every response, so a
// request that loaded the session *before* /logout and responds *after* it
// wrote the destroyed session straight back into the store.
async function buildApp(gate: Promise<void>): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(cookie);
  await app.register(session, {
    secret: 'x'.repeat(32),
    cookieName: 'sid',
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, path: '/' },
    store: createSessionStore(),
  });
  app.post('/login', async (req) => { req.session.userId = 1; return { ok: true }; });
  app.get('/slow', async () => { await gate; return { ok: true }; });
  app.post('/logout', async (req) => { await req.session.destroy(); return { ok: true }; });
  app.post('/rotate', async (req) => {
    await rotateSession(req);
    req.session.userId = 1;
    return { ok: true };
  });
  app.get('/me', async (req) => ({ userId: req.session.userId ?? null }));
  return app;
}

function sidCookie(res: { cookies: Array<{ name: string; value: string }> }): string {
  const c = res.cookies.find((x) => x.name === 'sid');
  if (!c) throw new Error('no sid cookie');
  return `sid=${c.value}`;
}

let app: FastifyInstance | undefined;
afterEach(async () => { await app?.close(); app = undefined; });

describe('session store', () => {
  it('an in-flight request does not resurrect a session destroyed by logout', async () => {
    let release!: () => void;
    app = await buildApp(new Promise<void>((r) => { release = r; }));
    const cookieHeader = sidCookie(await app.inject({ method: 'POST', url: '/login' }));

    const slow = app.inject({ method: 'GET', url: '/slow', headers: { cookie: cookieHeader } });
    await new Promise((r) => setTimeout(r, 20)); // let /slow load the session
    await app.inject({ method: 'POST', url: '/logout', headers: { cookie: cookieHeader } });
    release();
    await slow;

    const me = await app.inject({ method: 'GET', url: '/me', headers: { cookie: cookieHeader } });
    expect(me.json().userId).toBeNull();
  });

  it('an in-flight request does not resurrect the pre-regenerate session', async () => {
    let release!: () => void;
    app = await buildApp(new Promise<void>((r) => { release = r; }));
    const oldCookie = sidCookie(await app.inject({ method: 'POST', url: '/login' }));

    const slow = app.inject({ method: 'GET', url: '/slow', headers: { cookie: oldCookie } });
    await new Promise((r) => setTimeout(r, 20));
    const rotated = await app.inject({ method: 'POST', url: '/rotate', headers: { cookie: oldCookie } });
    release();
    await slow;

    const stale = await app.inject({ method: 'GET', url: '/me', headers: { cookie: oldCookie } });
    expect(stale.json().userId).toBeNull();
    const fresh = await app.inject({ method: 'GET', url: '/me', headers: { cookie: sidCookie(rotated) } });
    expect(fresh.json().userId).toBe(1);
  });

  it('keeps ordinary sessions working across requests', async () => {
    app = await buildApp(Promise.resolve());
    const cookieHeader = sidCookie(await app.inject({ method: 'POST', url: '/login' }));
    await app.inject({ method: 'GET', url: '/slow', headers: { cookie: cookieHeader } });
    const me = await app.inject({ method: 'GET', url: '/me', headers: { cookie: cookieHeader } });
    expect(me.json().userId).toBe(1);
  });
});
