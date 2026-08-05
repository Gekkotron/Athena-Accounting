// requires Postgres or PGlite — run with RUN_DB_TESTS=1 (DB_DRIVER=pglite).
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { eq } from 'drizzle-orm';
import { __setBackupFetchForTests } from '../src/domain/backup/providers.js';
import { decryptEnvelope, type EncryptedEnvelope } from '../src/http/routes/backup/crypto.js';

const RUN = !!process.env.RUN_DB_TESTS;

let app: FastifyInstance;
let cookieA: string;
let cookieB: string;
let userAId: number;
let dir: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let schema: any;

const PASSPHRASE = 'strong-backup-passphrase';
const folderPayload = (over: Record<string, unknown> = {}) => ({
  kind: 'folder',
  path: dir,
  keepLast: 30,
  passphrase: PASSPHRASE,
  ...over,
});

describe.skipIf(!RUN)('/api/backup/destination', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();
    ({ db } = await import('../src/db/client.js'));
    schema = await import('../src/db/schema.js');
    dir = await mkdtemp(join(tmpdir(), 'athena-dest-'));
    for (const [user, pass] of [
      ['backup-dest-a', 'backup-dest-1234'],
      ['backup-dest-b', 'backup-dest-5678'],
    ] as const) {
      const created = await app.inject({
        method: 'POST',
        url: '/api/onboarding/create',
        payload: { username: user, password: pass },
      });
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: user, password: pass },
      });
      const cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;
      if (user === 'backup-dest-a') {
        cookieA = cookie;
        userAId = created.json().user.id;
      } else {
        cookieB = cookie;
      }
    }
  });

  afterAll(async () => {
    // Scoped to this suite's user — on CI every suite shares one Postgres.
    await db.delete(schema.backupDestinations).where(eq(schema.backupDestinations.userId, userAId));
    await rm(dir, { recursive: true, force: true });
    await app.close();
  });

  afterEach(() => __setBackupFetchForTests(null));

  it('requires auth on every route', async () => {
    for (const [method, url] of [
      ['GET', '/api/backup/destination'],
      ['PUT', '/api/backup/destination'],
      ['DELETE', '/api/backup/destination'],
      ['POST', '/api/backup/destination/run-now'],
    ] as const) {
      expect((await app.inject({ method, url })).statusCode).toBe(401);
    }
  });

  it('run-now without a destination is a 409', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/backup/destination/run-now',
      headers: { cookie: cookieA },
    });
    expect(res.statusCode).toBe(409);
  });

  it('rejects a relative folder path and a short passphrase with 400', async () => {
    for (const payload of [folderPayload({ path: 'relative/dir' }), folderPayload({ passphrase: 'short' })]) {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/backup/destination',
        headers: { cookie: cookieA },
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it('a nonexistent folder fails the live probe with 502 and stores nothing', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/backup/destination',
      headers: { cookie: cookieA },
      payload: folderPayload({ path: join(dir, 'missing-mount') }),
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('destination test failed');
    const get = await app.inject({
      method: 'GET',
      url: '/api/backup/destination',
      headers: { cookie: cookieA },
    });
    expect(get.json().configured).toBe(false);
  });

  it('stores a folder destination after a successful probe, never echoing secrets', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/backup/destination',
      headers: { cookie: cookieA },
      payload: folderPayload({ keepLast: 2 }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      configured: true,
      kind: 'folder',
      enabled: true,
      config: { path: dir, keepLast: 2 },
      lastRunAt: null,
      lastError: null,
    });
    expect(res.body).not.toContain(PASSPHRASE);
    expect(res.json().auto.hour).toBe(3);
    expect(await readdir(dir)).toEqual([]); // probe file cleaned up

    // Secrets encrypted at rest.
    const rows = await db
      .select()
      .from(schema.backupDestinations)
      .where(eq(schema.backupDestinations.userId, userAId));
    expect(rows).toHaveLength(1);
    expect(rows[0].passphraseEncrypted).not.toContain(PASSPHRASE);
  });

  it('run-now pushes a decryptable enc1 file and records the run', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/backup/destination/run-now',
      headers: { cookie: cookieA },
    });
    expect(res.statusCode).toBe(200);
    const { filename } = res.json();
    expect(filename).toMatch(/^athena-backup-\d{4}-\d{2}-\d{2}-\d{6}\.enc\.json$/);
    const envelope = JSON.parse((await readFile(join(dir, filename))).toString()) as EncryptedEnvelope;
    const dump = JSON.parse(decryptEnvelope(envelope, PASSPHRASE));
    expect(dump.instance).toBe('athena-accounting');
    const get = await app.inject({
      method: 'GET',
      url: '/api/backup/destination',
      headers: { cookie: cookieA },
    });
    expect(get.json().lastRunAt).not.toBeNull();
    expect(get.json().lastError).toBeNull();
  });

  it('run-now prunes beyond keepLast but never a foreign file', async () => {
    // Start from a known state — the previous test already pushed a file
    // (possibly colliding on the same one-second stamp as this run).
    for (const n of await readdir(dir)) {
      if (n.startsWith('athena-backup-')) await rm(join(dir, n));
    }
    await writeFile(join(dir, 'athena-backup-2020-01-01-000000.enc.json'), 'old');
    await writeFile(join(dir, 'athena-backup-2020-01-02-000000.enc.json'), 'old');
    await writeFile(join(dir, 'athena-backup-2020-01-03-000000.enc.json'), 'old');
    await writeFile(join(dir, 'notes-perso.txt'), 'keep me');
    const res = await app.inject({
      method: 'POST',
      url: '/api/backup/destination/run-now',
      headers: { cookie: cookieA },
    });
    expect(res.statusCode).toBe(200);
    const names = await readdir(dir);
    expect(names).toContain('notes-perso.txt');
    // keepLast 2 → the two oldest of the four backups are pruned.
    expect(names).not.toContain('athena-backup-2020-01-01-000000.enc.json');
    expect(names).not.toContain('athena-backup-2020-01-02-000000.enc.json');
    expect(names).toContain('athena-backup-2020-01-03-000000.enc.json');
    expect(names.filter((n) => n.startsWith('athena-backup-'))).toHaveLength(2);
  });

  it('validates a webdav destination through the injected fetch', async () => {
    const methods: string[] = [];
    __setBackupFetchForTests((async (_url: RequestInfo | URL, init?: RequestInit) => {
      methods.push(init?.method ?? 'GET');
      return new Response(null, { status: 201 });
    }) as typeof fetch);
    const res = await app.inject({
      method: 'PUT',
      url: '/api/backup/destination',
      headers: { cookie: cookieA },
      payload: {
        kind: 'webdav',
        url: 'http://nas.local:5005/dav',
        username: 'julien',
        password: 'p4ss',
        subdir: 'athena',
        keepLast: 10,
        passphrase: PASSPHRASE,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(methods).toEqual(['PUT', 'DELETE']); // probe write + cleanup
    expect(res.body).not.toContain('p4ss');
    // Password encrypted at rest.
    const rows = await db
      .select()
      .from(schema.backupDestinations)
      .where(eq(schema.backupDestinations.userId, userAId));
    expect(rows[0].secretEncrypted).not.toContain('p4ss');
  });

  it('a webdav 401 on the probe maps to 502 with a readable detail', async () => {
    __setBackupFetchForTests((async () => new Response(null, { status: 401 })) as typeof fetch);
    const res = await app.inject({
      method: 'PUT',
      url: '/api/backup/destination',
      headers: { cookie: cookieA },
      payload: {
        kind: 'webdav',
        url: 'http://nas.local:5005/dav',
        username: 'julien',
        password: 'wrong',
        keepLast: 10,
        passphrase: PASSPHRASE,
      },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().detail).toMatch(/authentication failed/i);
  });

  it('scopes per user — user B sees unconfigured', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/backup/destination',
      headers: { cookie: cookieB },
    });
    expect(res.json().configured).toBe(false);
  });

  it('DELETE removes the destination and its secrets', async () => {
    const del = await app.inject({
      method: 'DELETE',
      url: '/api/backup/destination',
      headers: { cookie: cookieA },
    });
    expect(del.statusCode).toBe(200);
    const rows = await db
      .select()
      .from(schema.backupDestinations)
      .where(eq(schema.backupDestinations.userId, userAId));
    expect(rows).toHaveLength(0);
  });
});
