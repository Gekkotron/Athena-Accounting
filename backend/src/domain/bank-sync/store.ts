import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { bankSyncCredentials } from '../../db/schema.js';
import { env } from '../../env.js';
import { bankSyncKey, encryptPrivateKey, decryptPrivateKey } from './crypto.js';

export type BankSyncCredentials = { applicationId: string; privateKey: string };

export async function getCredentials(userId: number): Promise<BankSyncCredentials | null> {
  const [row] = await db
    .select({
      applicationId: bankSyncCredentials.applicationId,
      privateKeyEncrypted: bankSyncCredentials.privateKeyEncrypted,
    })
    .from(bankSyncCredentials)
    .where(eq(bankSyncCredentials.userId, userId));
  if (!row) return null;
  return {
    applicationId: row.applicationId,
    privateKey: decryptPrivateKey(bankSyncKey(env.SESSION_SECRET), userId, row.privateKeyEncrypted),
  };
}

export async function setCredentials(
  userId: number,
  applicationId: string,
  privateKeyPem: string,
): Promise<void> {
  const encrypted = encryptPrivateKey(bankSyncKey(env.SESSION_SECRET), userId, privateKeyPem);
  await db
    .insert(bankSyncCredentials)
    .values({ userId, applicationId, privateKeyEncrypted: encrypted })
    .onConflictDoUpdate({
      target: bankSyncCredentials.userId,
      set: { applicationId, privateKeyEncrypted: encrypted, updatedAt: new Date() },
    });
}

export async function deleteCredentials(userId: number): Promise<void> {
  await db.delete(bankSyncCredentials).where(eq(bankSyncCredentials.userId, userId));
}

export async function getStatus(
  userId: number,
): Promise<{ configured: boolean; applicationId: string | null }> {
  const [row] = await db
    .select({ applicationId: bankSyncCredentials.applicationId })
    .from(bankSyncCredentials)
    .where(eq(bankSyncCredentials.userId, userId));
  return row ? { configured: true, applicationId: row.applicationId } : { configured: false, applicationId: null };
}
