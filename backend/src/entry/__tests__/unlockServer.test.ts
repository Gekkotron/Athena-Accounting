import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import {
  writeSnapshot, writeMarker, snapshotPath,
} from '../../db/snapshotStore.js';
import { encryptBuffer } from '../../lib/binaryEnvelope.js';
import { runUnlockServer } from '../unlockServer.js';

// Reserve a free loopback port synchronously so the test can talk to the
// server (via GET/POST) before the promise it returns has resolved — the
// real port is only known once runUnlockServer binds, and `port: 0` would
// hide it from the test until the very end.
async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as AddressInfo;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

const PASSWORD = 'pw-123456';
const PLAINTEXT = Buffer.from('fixture');

describe('runUnlockServer', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'athena-unlock-'));
    await writeSnapshot(dir, encryptBuffer(PLAINTEXT, PASSWORD));
    await writeMarker(dir, 'encrypted');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reports locked on /health, 403s a wrong password without resolving, then unlocks', async () => {
    const port = await getFreePort();
    const unlockPromise = runUnlockServer({ dir, port });
    const base = `http://127.0.0.1:${port}`;

    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ ok: false, locked: true, driver: 'pglite' });

    let settled = false;
    unlockPromise.then(
      () => { settled = true; },
      () => { settled = true; },
    );

    const wrong = await fetch(`${base}/api/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'totally-wrong' }),
    });
    expect(wrong.status).toBe(403);
    await expect(wrong.json()).resolves.toEqual({ error: 'wrong password' });

    // Give any stray microtask a chance to settle the promise before we
    // assert it hasn't — a wrong password must never resolve/reject it.
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);

    const right = await fetch(`${base}/api/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(right.status).toBe(200);
    await expect(right.json()).resolves.toEqual({ ok: true });

    const result = await unlockPromise;
    expect(result.port).toBe(port);
    expect(result.passphrase).toBe(PASSWORD);
    expect(result.snapshot).toEqual(PLAINTEXT);

    // The listener is closed once unlocked — a fresh connection must fail.
    await expect(fetch(`${base}/health`)).rejects.toThrow();
  });

  it('answers unrecognized routes with 423 while locked', async () => {
    const port = await getFreePort();
    const unlockPromise = runUnlockServer({ dir, port });
    const base = `http://127.0.0.1:${port}`;

    const res = await fetch(`${base}/anything`);
    expect(res.status).toBe(423);
    await expect(res.json()).resolves.toEqual({ error: 'locked' });

    const home = await fetch(`${base}/`);
    expect(home.status).toBe(200);
    expect(home.headers.get('content-type')).toContain('text/html');
    const html = await home.text();
    expect(html).toContain('Athena Accounting');
    expect(html).toContain('Mot de passe');
    expect(html).toContain('Déverrouiller');
    expect(html).toContain('Mot de passe incorrect');

    // Unlock so the server closes and the returned promise doesn't dangle
    // past the end of the test.
    await fetch(`${base}/api/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    });
    await unlockPromise;
  });

  it('rejects an oversized unlock body with 413 without resolving', async () => {
    const port = await getFreePort();
    const unlockPromise = runUnlockServer({ dir, port });
    const base = `http://127.0.0.1:${port}`;

    let settled = false;
    unlockPromise.then(
      () => { settled = true; },
      () => { settled = true; },
    );

    // A password field far past the 64KB cap.
    const oversized = JSON.stringify({ password: 'x'.repeat(100 * 1024) });
    const res = await fetch(`${base}/api/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: oversized,
    });
    expect(res.status).toBe(413);
    await expect(res.json()).resolves.toEqual({ error: 'payload too large' });

    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);

    // Clean up: unlock for real so the server closes and the promise
    // doesn't dangle past the end of the test.
    await fetch(`${base}/api/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    });
    await unlockPromise;
  });

  it('responds 500 (not 403) when the snapshot file itself is unreadable', async () => {
    // Delete the snapshot entirely (no .bak either, since this fixture only
    // ever writes once) — any password now fails inside readSnapshot()
    // (ENOENT), a different failure mode than a wrong password, and one a
    // "try again" 403 message would be actively misleading for.
    await rm(snapshotPath(dir), { force: true });

    const port = await getFreePort();
    const unlockPromise = runUnlockServer({ dir, port });
    const base = `http://127.0.0.1:${port}`;

    let settled = false;
    unlockPromise.then(
      () => { settled = true; },
      () => { settled = true; },
    );

    const res = await fetch(`${base}/api/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'snapshot unreadable' });

    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);

    // Restore the snapshot and complete a real unlock so the server closes
    // and the promise doesn't dangle past the end of the test.
    await writeSnapshot(dir, encryptBuffer(PLAINTEXT, PASSWORD));
    await fetch(`${base}/api/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    });
    await unlockPromise;
  });
});
