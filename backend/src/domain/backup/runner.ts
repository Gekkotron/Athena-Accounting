import { encryptEnvelope } from '../../http/routes/backup/crypto.js';
import { buildDump, backupFilename } from './dump.js';
import { createFolderProvider, createWebdavProvider, type BackupProvider } from './providers.js';
import { createFtpProvider } from './ftp.js';
import {
  getDestination,
  recordRun,
  type BackupDestinationRecord,
  type FolderConfig,
  type FtpConfig,
  type WebdavConfig,
} from './store.js';

// One backup run: build the dump, seal it under the stored passphrase,
// upload, prune. Shared by the run-now route and the scheduler.

export class BackupNotConfiguredError extends Error {
  constructor() {
    super('backup destination not configured');
    this.name = 'BackupNotConfiguredError';
  }
}

export function providerFor(dest: BackupDestinationRecord): BackupProvider {
  if (dest.kind === 'folder') return createFolderProvider((dest.config as FolderConfig).path);
  if (dest.kind === 'ftp') return createFtpProvider(dest.config as FtpConfig, dest.secret ?? '');
  return createWebdavProvider(dest.config as WebdavConfig, dest.secret ?? '');
}

// Upload then trim to the newest keepLast files. The stamp format sorts
// lexicographically = chronologically, and list() is pre-filtered to our
// filename pattern, so pruning can never touch a foreign file.
export async function uploadAndPrune(
  provider: BackupProvider,
  name: string,
  bytes: Buffer,
  keepLast: number,
): Promise<void> {
  await provider.upload(name, bytes);
  const names = (await provider.list()).sort();
  const excess = names.slice(0, Math.max(0, names.length - keepLast));
  for (const n of excess) await provider.remove(n);
}

export async function runBackupNow(userId: number): Promise<{ filename: string }> {
  const dest = await getDestination(userId);
  if (!dest) throw new BackupNotConfiguredError();
  try {
    const dump = await buildDump(userId);
    const envelope = encryptEnvelope(JSON.stringify(dump), dest.passphrase);
    const filename = backupFilename(new Date());
    const bytes = Buffer.from(JSON.stringify(envelope), 'utf8');
    await uploadAndPrune(providerFor(dest), filename, bytes, dest.config.keepLast);
    await recordRun(userId, { ok: true });
    return { filename };
  } catch (err) {
    await recordRun(userId, { ok: false, error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
