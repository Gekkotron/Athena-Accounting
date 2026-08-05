import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { backupDestinations } from '../../db/schema.js';
import { env } from '../../env.js';
import { backupSecretsKey, encryptSecret, decryptSecret } from './secrets.js';

// Persistence for the per-user remote backup destination. Secrets (WebDAV
// password + enc1 backup passphrase) are encrypted at rest — see secrets.ts.

export type WebdavConfig = { url: string; username: string; subdir: string | null; keepLast: number };
export type FolderConfig = { path: string; keepLast: number };
export type FtpConfig = { host: string; port: number; username: string; subdir: string | null; keepLast: number };

export type BackupDestinationRecord = {
  kind: 'webdav' | 'folder' | 'ftp';
  config: WebdavConfig | FolderConfig | FtpConfig;
  secret: string | null; // decrypted WebDAV/FTP password
  passphrase: string; // decrypted enc1 passphrase
  enabled: boolean;
  lastRunAt: Date | null;
  lastError: string | null;
};

export async function getDestination(userId: number): Promise<BackupDestinationRecord | null> {
  const [row] = await db
    .select()
    .from(backupDestinations)
    .where(eq(backupDestinations.userId, userId));
  if (!row) return null;
  const key = backupSecretsKey(env.SESSION_SECRET);
  return {
    kind: row.kind as 'webdav' | 'folder' | 'ftp',
    config: row.config as WebdavConfig | FolderConfig | FtpConfig,
    secret: row.secretEncrypted ? decryptSecret(key, userId, 'secret', row.secretEncrypted) : null,
    passphrase: decryptSecret(key, userId, 'passphrase', row.passphraseEncrypted),
    enabled: row.enabled,
    lastRunAt: row.lastRunAt,
    lastError: row.lastError,
  };
}

export async function setDestination(
  userId: number,
  input: {
    kind: 'webdav' | 'folder' | 'ftp';
    config: WebdavConfig | FolderConfig | FtpConfig;
    secret: string | null;
    passphrase: string;
    enabled: boolean;
  },
): Promise<void> {
  const key = backupSecretsKey(env.SESSION_SECRET);
  const values = {
    kind: input.kind,
    config: input.config,
    secretEncrypted: input.secret === null ? null : encryptSecret(key, userId, 'secret', input.secret),
    passphraseEncrypted: encryptSecret(key, userId, 'passphrase', input.passphrase),
    enabled: input.enabled,
  };
  await db
    .insert(backupDestinations)
    .values({ userId, ...values })
    .onConflictDoUpdate({
      target: backupDestinations.userId,
      // Replacing the destination resets the run status — the old
      // lastRunAt/lastError described a different target.
      set: { ...values, lastRunAt: null, lastError: null, updatedAt: new Date() },
    });
}

export async function deleteDestination(userId: number): Promise<void> {
  await db.delete(backupDestinations).where(eq(backupDestinations.userId, userId));
}

// Success moves lastRunAt and clears lastError; failure records lastError
// only. lastRunAt is the scheduler's dueness anchor, so a failed run stays
// due and retries on the next tick instead of waiting for tomorrow.
export async function recordRun(
  userId: number,
  result: { ok: true } | { ok: false; error: string },
): Promise<void> {
  await db
    .update(backupDestinations)
    .set(
      result.ok
        ? { lastRunAt: new Date(), lastError: null, updatedAt: new Date() }
        : { lastError: result.error, updatedAt: new Date() },
    )
    .where(eq(backupDestinations.userId, userId));
}

export async function listEnabledDestinations(): Promise<Array<{ userId: number; lastRunAt: Date | null }>> {
  return db
    .select({ userId: backupDestinations.userId, lastRunAt: backupDestinations.lastRunAt })
    .from(backupDestinations)
    .where(eq(backupDestinations.enabled, true));
}
