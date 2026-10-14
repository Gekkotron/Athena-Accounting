import type { FastifyRequest } from 'fastify';
import { MemoryStore } from '@fastify/session';

type Store = InstanceType<typeof MemoryStore>;
type Callback = (err?: unknown) => void;

// In-memory session store that refuses to resurrect destroyed sessions.
//
// @fastify/session runs with `rolling: true` (its default), which re-saves
// the session on *every* response. A request that loaded the session before
// /api/auth/logout — or before the session-id rotation on /2fa/verify — and
// responds after it would write the destroyed session straight back into
// the store, silently undoing the logout (or reviving the half-authenticated
// pre-2FA session). The Dashboard fires a burst of slow report queries on
// load, so this was easy to hit.
//
// destroy() leaves a tombstone; a later set() for a tombstoned id is a
// no-op. Ids are random and never reused, so a tombstone can only ever
// block a stale write. Tombstones are dropped once older than `ttlMs`
// (the cookie lifetime), after which the stale cookie is dead anyway.
export function createSessionStore(ttlMs = 30 * 24 * 60 * 60 * 1000): Store {
  const inner = new MemoryStore();
  const tombstones = new Map<string, number>();

  const prune = (now: number) => {
    for (const [id, at] of tombstones) {
      if (now - at <= ttlMs) break; // Map keeps insertion order: oldest first
      tombstones.delete(id);
    }
  };

  const store = Object.create(inner) as Store;
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
