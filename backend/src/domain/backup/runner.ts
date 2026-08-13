import { encryptBytes, encryptEnvelope } from '../../http/routes/backup/crypto.js';
import {
  attachmentArchiveFilename,
  isAttachmentArchiveFilename,
} from '../../http/routes/backup/attachments-archive.js';
import { buildDump, backupFilename } from './dump.js';
import {
  archiveToGzippedJson,
  buildAttachmentsArchive,
} from './attachments-archive.js';
import {
  computeAttachmentFingerprint,
  readAttachmentFingerprint,
} from './attachments-fingerprint.js';
import {
  createFolderProvider,
  createWebdavProvider,
  type BackupNameFilter,
  type BackupProvider,
} from './providers.js';
import { createFtpProvider } from './ftp.js';
import {
  getDestination,
  recordRun,
  setAttachmentFingerprint,
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

// Upload then trim to the newest keepLast files matching `filter`. The
// stamp format sorts lexicographically = chronologically, and the filter
// pre-scopes list() to our filename pattern, so pruning can never touch a
// foreign file — nor a sibling family (JSON dump vs attachment archive).
export async function uploadAndPrune(
  provider: BackupProvider,
  name: string,
  bytes: Buffer,
  keepLast: number,
  filter?: BackupNameFilter,
): Promise<void> {
  await provider.upload(name, bytes);
  const names = (await provider.list(filter)).sort();
  const excess = names.slice(0, Math.max(0, names.length - keepLast));
  for (const n of excess) await provider.remove(n);
}


export interface BackupRunSummary {
  filename: string;
  // Present only when the attachment archive was (re)uploaded on this run.
  // Absent when the fingerprint matched the previously-stored value and the
  // attachment upload was skipped — the empty-diff nightly case.
  attachmentsFilename?: string;
}

export async function runBackupNow(userId: number): Promise<BackupRunSummary> {
  const dest = await getDestination(userId);
  if (!dest) throw new BackupNotConfiguredError();
  try {
    const provider = providerFor(dest);
    const dump = await buildDump(userId);
    const envelope = encryptEnvelope(JSON.stringify(dump), dest.passphrase);
    const filename = backupFilename(new Date());
    const bytes = Buffer.from(JSON.stringify(envelope), 'utf8');
    await uploadAndPrune(provider, filename, bytes, dest.config.keepLast);

    // Attachment archive — uploaded only when the user's attachment library
    // fingerprint has moved since the last successful archive upload. The
    // JSON dump is small enough to justify an unconditional refresh; the
    // archive is not.
    let attachmentsFilename: string | undefined;
    const fingerprint = await readAttachmentFingerprint(userId);
    if (fingerprint !== dest.lastAttachmentFingerprint) {
      const archive = await buildAttachmentsArchive(userId);
      const gzipped = archiveToGzippedJson(archive);
      const archiveEnvelope = encryptBytes(gzipped, dest.passphrase);
      attachmentsFilename = attachmentArchiveFilename(new Date());
      await uploadAndPrune(
        provider,
        attachmentsFilename,
        archiveEnvelope,
        dest.config.keepLast,
        isAttachmentArchiveFilename,
      );
      await setAttachmentFingerprint(userId, fingerprint);
    }

    await recordRun(userId, { ok: true });
    return attachmentsFilename ? { filename, attachmentsFilename } : { filename };
  } catch (err) {
    await recordRun(userId, { ok: false, error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

// Re-export for tests that want to exercise the fingerprint helper directly.
export { computeAttachmentFingerprint };
