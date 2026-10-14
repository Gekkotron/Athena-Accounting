import type { FastifyInstance, FastifyRequest } from 'fastify';
import session, { MemoryStore } from '@fastify/session';

type Store = InstanceType<typeof MemoryStore>;
export type RevocationAwareStore = Store & { isRevoked(id: string): boolean };
type Callback = (err?: unknown) => void;

// In-memory session store that refuses to resurrect destroyed sessions.
//
// @fastify/session saves the session at the end of any request that
// modified it (and, with its default `rolling: true`, of every request). A
// request that loaded the session before /api/auth/logout — or before the
// session-id rotation on /2fa/verify — and responds after it would write the
// destroyed session straight back into the store, silently undoing the
// logout (or reviving the half-authenticated pre-2FA session). The Dashboard
// fires a burst of slow report queries on load, so this was easy to hit
// while rolling was on; the tombstone keeps it closed for modifying requests.
//
// destroy() leaves a tombstone; a later set() for a tombstoned id is a
// no-op. Ids are random and never reused, so a tombstone can only ever
// block a stale write. Tombstones are dropped once older than `ttlMs`
// (the cookie lifetime), after which the stale cookie is dead anyway.
export function createSessionStore(ttlMs = 30 * 24 * 60 * 60 * 1000): RevocationAwareStore {
  const inner = new MemoryStore();
  const tombstones = new Map<string, number>();

  const prune = (now: number) => {
    for (const [id, at] of tombstones) {
      if (now - at <= ttlMs) break; // Map keeps insertion order: oldest first
      tombstones.delete(id);
    }
  };

  const store = Object.create(inner) as RevocationAwareStore;
  store.isRevoked = (id: string) => tombstones.has(id);
  store.set = (id: string, session: unknown, cb: Callback) => {
    if (tombstones.has(id)) return cb();
    inner.set(id, session as never, cb);
  };
  store.destroy = (id: string, cb: Callback) => {
    const now = Date.now();
    prune(now);
    tombstones.set(id, now);
    inner.destroy(id, cb);
  };
  return store;
}

// Session-id rotation that actually retires the old id. @fastify/session's
// regenerate() only mints a new session — the old one stays valid in the
// store, so a stolen pre-login (or pre-2FA, totpPending) cookie would keep
// working after rotation. Destroying it here also tombstones it, so an
// in-flight request still holding the old cookie can't write it back.
export async function rotateSession(req: FastifyRequest): Promise<void> {
  const oldId = req.session.sessionId;
  await req.session.regenerate();
  await new Promise<void>((resolve, reject) => {
    req.sessionStore.destroy(oldId, (err?: unknown) => (err ? reject(err) : resolve()));
  });
}

// Browser-side half of the rotation race. Requests the browser sent with
// the pre-rotation cookie can answer *after* the response carrying the new
// one, and @fastify/session then writes the session cookie again:
//   - a request that loaded the old session before it was destroyed re-sends
//     the old (now dead) cookie (`rolling`), and
//   - a request whose cookie no longer matches any session gets a clearing
//     `Set-Cookie: <name>=; Max-Age=0`.
// Either one overwrites the fresh cookie in the browser and logs the user
// out right after login / 2FA. Lazy-loaded asset chunks fired in the same
// tick as the verify response were enough to hit it.
//
// This onSend hook runs after the session plugin's and drops both. A dead
// cookie left in the browser is harmless: it maps to no session, and the
// next login replaces it. Logout never relied on the clear — destroy()
// nulls request.session, so @fastify/session sends no cookie at all there.
export function guardSessionCookie(
  app: FastifyInstance,
  store: RevocationAwareStore,
  cookieName: string,
): void {
  const prefix = `${cookieName}=`;
  app.addHook('onSend', async (req, reply, payload) => {
    const header = reply.getHeader('set-cookie');
    if (header === undefined) return payload;
    const cookies = Array.isArray(header) ? header.map(String) : [String(header)];
    const staleSession = !!req.session && store.isRevoked(req.session.sessionId);
    const kept = cookies.filter((c) => {
      if (!c.startsWith(prefix)) return true;
      if (c.startsWith(`${prefix};`)) return false; // clear for an unknown id
      return !staleSession;
    });
    if (kept.length === cookies.length) return payload;
    if (kept.length === 0) reply.removeHeader('set-cookie');
    else reply.header('set-cookie', kept);
    return payload;
  });
}

// Session plugin wiring shared by the app (plugins/auth.ts) and its tests,
// so the regression tests exercise the production configuration.
//
// `rolling: false` — with @fastify/session's default (`true`) every
// response, static assets included, re-sends the session cookie. Responses
// to requests the browser sent just before a login / 2FA rotation (the PWA
// service worker precaches every asset right after sign-in) can reach the
// browser *after* the one carrying the new cookie and put the old one back.
// It never extended anything either: touch() is not called, so the
// re-sent cookie kept its original Expires. With `false` the cookie is only
// sent when the session itself changes (login, verify, rotation).
export async function registerSession(
  app: FastifyInstance,
  opts: { secret: string; cookieName: string; secure: boolean; maxAgeMs?: number },
): Promise<RevocationAwareStore> {
  const store = createSessionStore(opts.maxAgeMs);
  await app.register(session, {
    secret: opts.secret,
    cookieName: opts.cookieName,
    saveUninitialized: false,
    rolling: false,
    store,
    cookie: {
      secure: opts.secure,
      httpOnly: true,
      sameSite: 'lax',
      ...(opts.maxAgeMs !== undefined ? { maxAge: opts.maxAgeMs } : {}),
      path: '/',
    },
  });
  // Registered after the session plugin so this onSend runs second.
  guardSessionCookie(app, store, opts.cookieName);
  return store;
}
