// requires Postgres or PGlite + onboarding setup — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';

const RUN = !!process.env.RUN_DB_TESTS;

let app: FastifyInstance;
let cookie: string;
let accountId: number;
let watchDir: string;

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function ofxFixture(fitidPrefix: string): string {
  return [
    'OFXHEADER:100', 'DATA:OFXSGML', 'VERSION:102', 'ENCODING:USASCII',
    'CHARSET:UTF-8', '', '',
    '<OFX><STMTTRN><DTPOSTED>20260615000000<TRNAMT>-25.30<NAME>CARREFOUR WATCH',
    `<FITID>${fitidPrefix}-1</STMTTRN>`,
    '<STMTTRN><DTPOSTED>20260616000000<TRNAMT>-9.99<NAME>SPOTIFY WATCH',
    `<FITID>${fitidPrefix}-2</STMTTRN></OFX>`,
  ].join('\r\n');
}

describe.skipIf(!RUN)('watch-folder imports', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();

    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'watch-user', password: 'watch-12345' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'watch-user', password: 'watch-12345' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;

    const acc = await app.inject({
      method: 'POST', url: '/api/accounts', headers: { cookie },
      payload: { name: 'Compte Courant Watch', type: 'checking', openingDate: '2026-01-01' },
    });
    accountId = acc.json().account.id;

    watchDir = await mkdtemp(join(tmpdir(), 'athena-watch-'));
  });

  it('imports an OFX dropped in a matching account subfolder and renames it .imported', async () => {
    const { scanWatchFolderOnce } = await import('../src/domain/imports/watch-folder.js');
    const sub = join(watchDir, 'compte courant watch');
    await mkdir(sub, { recursive: true });
    await writeFile(join(sub, 'mai.ofx'), ofxFixture('watch-a'));

    const result = await scanWatchFolderOnce(watchDir, log);
    expect(result.imported).toBe(1);
    expect(result.failed).toBe(0);

    const files = await readdir(sub);
    expect(files).toContain('mai.ofx.imported');
    expect(files).not.toContain('mai.ofx');

    const txs = await app.inject({
      method: 'GET', url: `/api/transactions?accountId=${accountId}`, headers: { cookie },
    });
    const labels = txs.json().transactions.map((t: { rawLabel: string }) => t.rawLabel);
    expect(labels).toContain('CARREFOUR WATCH');
    expect(labels).toContain('SPOTIFY WATCH');
  });

  it('is idempotent — a second scan finds nothing to do', async () => {
    const { scanWatchFolderOnce } = await import('../src/domain/imports/watch-folder.js');
    const result = await scanWatchFolderOnce(watchDir, log);
    expect(result.imported).toBe(0);
    expect(result.failed).toBe(0);
  });

  it('marks an unparseable file .failed with a sibling .error.txt and keeps going', async () => {
    const { scanWatchFolderOnce } = await import('../src/domain/imports/watch-folder.js');
    const sub = join(watchDir, 'Compte Courant Watch');
    await mkdir(sub, { recursive: true });
    await writeFile(join(sub, 'bad.pdf'), 'this is not a pdf');
    await writeFile(join(sub, 'juin.ofx'), ofxFixture('watch-b'));

    const result = await scanWatchFolderOnce(watchDir, log);
    expect(result.failed).toBe(1);
    expect(result.imported).toBe(1);

    const files = await readdir(sub);
    expect(files).toContain('bad.pdf.failed');
    expect(files).toContain('bad.pdf.error.txt');
    expect(files).toContain('juin.ofx.imported');
  });

  it('skips unmatched subfolders and root-level files with a warning, never guessing', async () => {
    const { scanWatchFolderOnce } = await import('../src/domain/imports/watch-folder.js');
    const sub = join(watchDir, 'dossier inconnu');
    await mkdir(sub, { recursive: true });
    await writeFile(join(sub, 'orphan.ofx'), ofxFixture('watch-c'));
    await writeFile(join(watchDir, 'root.ofx'), ofxFixture('watch-d'));

    log.warn.mockClear();
    const result = await scanWatchFolderOnce(watchDir, log);
    expect(result.imported).toBe(0);
    expect(log.warn).toHaveBeenCalled();

    // Both files stay untouched so fixing the folder name later just works.
    expect(await readdir(sub)).toEqual(['orphan.ofx']);
    expect(await readdir(watchDir)).toContain('root.ofx');
  });
});
