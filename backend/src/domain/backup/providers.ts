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
