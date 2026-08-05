import { describe, it, expect, afterEach } from 'vitest';
import {
  createWebdavProvider,
  __setBackupFetchForTests,
  BackupProviderError,
} from '../src/domain/backup/providers.js';

type Call = { method: string; url: string; headers: Record<string, string> };
const NAME = 'athena-backup-2026-08-05-030000.enc.json';

function fakeFetch(script: (call: Call, n: number) => Response): Call[] {
  const calls: Call[] = [];
  __setBackupFetchForTests((async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? 'GET',
      url: String(input),
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
    };
    calls.push(call);
    return script(call, calls.length);
  }) as typeof fetch);
  return calls;
}

afterEach(() => __setBackupFetchForTests(null));

const CFG = { url: 'http://nas.local:5005/dav/', username: 'julien', subdir: 'athena' };

describe('webdav provider', () => {
  it('uploads with basic auth to url/subdir/name', async () => {
    const calls = fakeFetch(() => new Response(null, { status: 201 }));
    await createWebdavProvider(CFG, 'p4ss').upload(NAME, Buffer.from('x'));
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('PUT');
    expect(calls[0].url).toBe(`http://nas.local:5005/dav/athena/${NAME}`);
    expect(calls[0].headers.authorization).toBe('Basic ' + Buffer.from('julien:p4ss').toString('base64'));
  });
  it('a 409 PUT creates the collection with MKCOL then retries once', async () => {
    const calls = fakeFetch((_call, n) =>
      n === 1 ? new Response(null, { status: 409 }) : new Response(null, { status: 201 }),
    );
    await createWebdavProvider(CFG, 'p4ss').upload(NAME, Buffer.from('x'));
    expect(calls.map((c) => c.method)).toEqual(['PUT', 'MKCOL', 'PUT']);
    expect(calls[1].url).toBe('http://nas.local:5005/dav/athena');
  });
  it('maps 401 to a readable error', async () => {
    fakeFetch(() => new Response(null, { status: 401 }));
    await expect(createWebdavProvider(CFG, 'wrong').upload(NAME, Buffer.from('x'))).rejects.toThrow(
      /authentication failed/i,
    );
  });
  it('lists via PROPFIND depth 1, decodes hrefs, filters foreign files', async () => {
    const xml = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">
      <d:response><d:href>/dav/athena/</d:href></d:response>
      <d:response><d:href>/dav/athena/${NAME}</d:href></d:response>
      <d:response><d:href>/dav/athena/athena-backup-2026-08-04-030000.enc.json</d:href></d:response>
      <d:response><d:href>/dav/athena/notes%20perso.txt</d:href></d:response>
    </d:multistatus>`;
    const calls = fakeFetch(() => new Response(xml, { status: 207 }));
    const names = await createWebdavProvider(CFG, 'p4ss').list();
    expect(calls[0].method).toBe('PROPFIND');
    expect(calls[0].headers.depth).toBe('1');
    expect(names).toEqual(['athena-backup-2026-08-04-030000.enc.json', NAME]);
  });
  it('an unlisted (404) directory lists as empty', async () => {
    fakeFetch(() => new Response(null, { status: 404 }));
    expect(await createWebdavProvider(CFG, 'p4ss').list()).toEqual([]);
  });
  it('remove issues DELETE and tolerates 404', async () => {
    const calls = fakeFetch(() => new Response(null, { status: 404 }));
    await createWebdavProvider(CFG, 'p4ss').remove(NAME);
    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].url).toBe(`http://nas.local:5005/dav/athena/${NAME}`);
  });
  it('network failure surfaces as BackupProviderError with the cause', async () => {
    __setBackupFetchForTests((async () => {
      throw new TypeError('fetch failed: ECONNREFUSED');
    }) as typeof fetch);
    await expect(createWebdavProvider(CFG, 'p4ss').list()).rejects.toThrow(BackupProviderError);
  });
});
