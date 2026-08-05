import { readdir, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { isBackupFilename } from './dump.js';

// Destination abstraction for scheduled remote backups. Two providers:
// a local/mounted folder (SMB/NFS mount, external disk) and WebDAV
// (Freebox, Synology, QNAP, Nextcloud) over plain fetch — no npm dep.
// list() pre-filters to backup-named files so retention pruning can NEVER
// delete a foreign file living in the same directory.

export interface BackupProvider {
  upload(name: string, bytes: Buffer): Promise<void>;
  list(): Promise<string[]>;
  remove(name: string): Promise<void>;
}

export class BackupProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupProviderError';
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Names come from our own stamp or the PUT-validation probe; anything with
// a path separator is refused outright.
function assertPlainName(name: string): void {
  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw new BackupProviderError(`invalid backup filename: ${name}`);
  }
}

export function createFolderProvider(dirPath: string): BackupProvider {
  // A relative path would resolve against the server's cwd — always a bug.
  if (!isAbsolute(dirPath)) throw new BackupProviderError('folder path must be absolute');
  return {
    async upload(name, bytes) {
      assertPlainName(name);
      // Temp file + rename: a crash mid-write never leaves a truncated
      // backup under a name the pruner (or the user) would trust. The
      // directory must already exist — creating it here would silently
      // write to a local stub when an SMB/NFS mount is down.
      const tmp = join(dirPath, `.tmp-${name}`);
      try {
        await writeFile(tmp, bytes);
        await rename(tmp, join(dirPath, name));
      } catch (err) {
        await rm(tmp, { force: true }).catch(() => {});
        throw new BackupProviderError(`folder write failed: ${errMsg(err)}`);
      }
    },
    async list() {
      try {
        return (await readdir(dirPath)).filter(isBackupFilename).sort();
      } catch (err) {
        throw new BackupProviderError(`folder list failed: ${errMsg(err)}`);
      }
    },
    async remove(name) {
      assertPlainName(name);
      try {
        await rm(join(dirPath, name), { force: true });
      } catch (err) {
        throw new BackupProviderError(`folder delete failed: ${errMsg(err)}`);
      }
    },
  };
}

// Injectable fetch, same policy as the Enable Banking client: tests never
// touch the network.
let testFetch: typeof fetch | null = null;
export function __setBackupFetchForTests(f: typeof fetch | null): void {
  testFetch = f;
}

export function createWebdavProvider(
  cfg: { url: string; username: string; subdir: string | null },
  password: string,
): BackupProvider {
  const auth = 'Basic ' + Buffer.from(`${cfg.username}:${password}`).toString('base64');
  const base = cfg.url.replace(/\/+$/, '');
  const segments = (cfg.subdir ?? '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(encodeURIComponent);
  const dirUrl = [base, ...segments].join('/');
  const fileUrl = (name: string) => `${dirUrl}/${encodeURIComponent(name)}`;

  async function request(method: string, url: string, extra: RequestInit = {}): Promise<Response> {
    try {
      return await (testFetch ?? fetch)(url, {
        ...extra,
        method,
        headers: { authorization: auth, ...(extra.headers as Record<string, string> | undefined) },
      });
    } catch (err) {
      throw new BackupProviderError(`webdav ${method} failed: ${errMsg(err)}`);
    }
  }

  function httpError(action: string, status: number): BackupProviderError {
    if (status === 401 || status === 403) {
      return new BackupProviderError(`webdav ${action}: authentication failed (HTTP ${status})`);
    }
    return new BackupProviderError(`webdav ${action}: HTTP ${status}`);
  }

  async function put(name: string, bytes: Buffer): Promise<Response> {
    return request('PUT', fileUrl(name), { body: new Uint8Array(bytes) });
  }

  return {
    async upload(name, bytes) {
      assertPlainName(name);
      let res = await put(name, bytes);
      if (res.status === 409 && segments.length > 0) {
        // Missing collection — create each subdir level then retry once.
        // 405 = already exists, fine.
        let url = base;
        for (const seg of segments) {
          url = `${url}/${seg}`;
          const mk = await request('MKCOL', url);
          if (!mk.ok && mk.status !== 405) throw httpError('mkcol', mk.status);
        }
        res = await put(name, bytes);
      }
      if (!res.ok) throw httpError('upload', res.status);
    },
    async list() {
      const res = await request('PROPFIND', dirUrl, { headers: { depth: '1' } });
      if (res.status === 404) return []; // nothing pushed yet
      if (!res.ok && res.status !== 207) throw httpError('list', res.status);
      const xml = await res.text();
      // Only <href> extraction is needed — no XML parser. Namespace prefix
      // varies by server (d:, D:, none), so match on the local name.
      const names: string[] = [];
      for (const m of xml.matchAll(/<[^<>]*href[^<>]*>([^<]+)<\/[^<>]*href[^<>]*>/gi)) {
        const decoded = decodeURIComponent((m[1] ?? '').trim());
        const basename = decoded.split('/').filter(Boolean).pop() ?? '';
        if (isBackupFilename(basename)) names.push(basename);
      }
      return names.sort();
    },
    async remove(name) {
      assertPlainName(name);
      const res = await request('DELETE', fileUrl(name));
      if (!res.ok && res.status !== 404) throw httpError('delete', res.status);
    },
  };
}
