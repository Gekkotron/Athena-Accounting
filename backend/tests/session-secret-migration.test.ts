// Integration test for the one-shot legacy-secret migration that runs at
// first Tauri boot after the audit-2026-09-17 upgrade. Seeds one user with
// rows in every SESSION_SECRET-derived field (TOTP, bank-sync, backup ×2,
// MCP wrap) encrypted under the LEGACY constant, then runs the migration
// under a fresh secret and asserts every ciphertext now decrypts under
// the new key and no longer under the old.
//
// DB-gated: needs the real schema in place. Skips locally when
// RUN_DB_TESTS is unset (matches the sibling backup/bank-sync suites).
import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

d('migrateSessionSecret', () => {
  beforeEach(async () => {
    // The migration walks EVERY row globally in each of the 4 tables — it
    // will throw the first time it can't decrypt an unrelated row under
    // OLD. Clean the tables so this test's seeded rows are the only ones
    // present. `users` can't be dropped (cascades), so just NULL its wrap
    // column.
    const { db } = await import('../src/db/client.js');
    const {
      userTotp, bankSyncCredentials, backupDestinations,
    } = await import('../src/db/schema.js');
    await db.delete(userTotp);
    await db.delete(bankSyncCredentials);
    await db.delete(backupDestinations);
    // Drizzle's `.set({ mcpKeyWrapped: null })` drops the column from the
    // SET clause (null == "don't touch"), producing a syntactically broken
    // UPDATE. Raw SQL is the clean way to null a column here.
    await db.execute(
      sql`UPDATE user_settings SET mcp_key_wrapped = NULL WHERE mcp_key_wrapped IS NOT NULL`,
    );
  });

  it('re-encrypts every SESSION_SECRET-derived ciphertext under the fresh secret', async () => {
    const { LEGACY_TAURI_SESSION_SECRET } = await import('../src/entry/session-secret.js');
    const { migrateSessionSecret } = await import('../src/entry/session-secret-migration.js');
    const { db } = await import('../src/db/client.js');
    const {
      userTotp, bankSyncCredentials, backupDestinations, userSettings,
    } = await import('../src/db/schema.js');
    const { seedUser } = await import('./helpers/seedUser.js');
    const { totpKey, encryptTotpSecret, decryptTotpSecret } = await import(
      '../src/domain/auth/totp-crypto.js'
    );
    const { bankSyncKey, encryptPrivateKey, decryptPrivateKey } = await import(
      '../src/domain/bank-sync/crypto.js'
    );
    const { backupSecretsKey, encryptSecret, decryptSecret } = await import(
      '../src/domain/backup/secrets.js'
    );
    const { masterKey, wrapKey, unwrapKey } = await import('../src/domain/mcp/crypto.js');

    const uid = await seedUser();
    const OLD = LEGACY_TAURI_SESSION_SECRET;
    const NEW = randomBytes(32).toString('hex');

    const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';
    const PRIVATE_KEY = '-----BEGIN RSA PRIVATE KEY-----\nfake-material\n-----END RSA PRIVATE KEY-----';
    const WEBDAV_PASSWORD = 'webdav-pw-secret';
    const BACKUP_PASSPHRASE = 'backup-passphrase-that-is-long-enough';
    const MCP_CONTENT_KEY = randomBytes(32);

    await db.insert(userTotp).values({
      userId: uid,
      secretCiphertext: encryptTotpSecret(totpKey(OLD), uid, TOTP_SECRET),
    });
    await db.insert(bankSyncCredentials).values({
      userId: uid,
      applicationId: 'app-id-abc',
      privateKeyEncrypted: encryptPrivateKey(bankSyncKey(OLD), uid, PRIVATE_KEY),
    });
    await db.insert(backupDestinations).values({
      userId: uid,
      kind: 'webdav',
      config: { url: 'https://example.invalid/dav', username: 'u' },
      secretEncrypted: encryptSecret(backupSecretsKey(OLD), uid, 'secret', WEBDAV_PASSWORD),
      passphraseEncrypted: encryptSecret(
        backupSecretsKey(OLD), uid, 'passphrase', BACKUP_PASSPHRASE,
      ),
    });
    await db.insert(userSettings).values({
      userId: uid,
      mcpKeyWrapped: wrapKey(masterKey(OLD), MCP_CONTENT_KEY),
    });

    const counts = await migrateSessionSecret(OLD, NEW);
    expect(counts).toEqual({
      userTotp: 1,
      bankSyncCredentials: 1,
      backupDestinations: 1,
      mcpKeys: 1,
    });

    const [totpRow] = await db.select().from(userTotp).where(eq(userTotp.userId, uid));
    expect(decryptTotpSecret(totpKey(NEW), uid, totpRow!.secretCiphertext)).toBe(TOTP_SECRET);
    expect(() => decryptTotpSecret(totpKey(OLD), uid, totpRow!.secretCiphertext)).toThrow();

    const [bankRow] = await db
      .select()
      .from(bankSyncCredentials)
      .where(eq(bankSyncCredentials.userId, uid));
    expect(decryptPrivateKey(bankSyncKey(NEW), uid, bankRow!.privateKeyEncrypted)).toBe(PRIVATE_KEY);
    expect(() =>
      decryptPrivateKey(bankSyncKey(OLD), uid, bankRow!.privateKeyEncrypted),
    ).toThrow();

    const [backupRow] = await db
      .select()
      .from(backupDestinations)
      .where(eq(backupDestinations.userId, uid));
    expect(
      decryptSecret(backupSecretsKey(NEW), uid, 'secret', backupRow!.secretEncrypted!),
    ).toBe(WEBDAV_PASSWORD);
    expect(
      decryptSecret(backupSecretsKey(NEW), uid, 'passphrase', backupRow!.passphraseEncrypted),
    ).toBe(BACKUP_PASSPHRASE);

    const [mcpRow] = await db
      .select({ w: userSettings.mcpKeyWrapped })
      .from(userSettings)
      .where(eq(userSettings.userId, uid));
    expect(Buffer.compare(unwrapKey(masterKey(NEW), mcpRow!.w!), MCP_CONTENT_KEY)).toBe(0);
    expect(() => unwrapKey(masterKey(OLD), mcpRow!.w!)).toThrow();
  });

  it('empty tables: returns all zeros without side effects', async () => {
    const { LEGACY_TAURI_SESSION_SECRET } = await import('../src/entry/session-secret.js');
    const { migrateSessionSecret } = await import('../src/entry/session-secret-migration.js');
    const NEW = randomBytes(32).toString('hex');
    const counts = await migrateSessionSecret(LEGACY_TAURI_SESSION_SECRET, NEW);
    expect(counts).toEqual({
      userTotp: 0,
      bankSyncCredentials: 0,
      backupDestinations: 0,
      mcpKeys: 0,
    });
  });

  it('rollback on failure: a bad ciphertext leaves every row untouched', async () => {
    const { LEGACY_TAURI_SESSION_SECRET } = await import('../src/entry/session-secret.js');
    const { migrateSessionSecret } = await import('../src/entry/session-secret-migration.js');
    const { db } = await import('../src/db/client.js');
    const { userTotp, bankSyncCredentials } = await import('../src/db/schema.js');
    const { seedUser } = await import('./helpers/seedUser.js');
    const { totpKey, encryptTotpSecret } = await import('../src/domain/auth/totp-crypto.js');

    const uid = await seedUser();
    const OLD = LEGACY_TAURI_SESSION_SECRET;
    const NEW = randomBytes(32).toString('hex');
    const seededTotp = encryptTotpSecret(totpKey(OLD), uid, 'JBSWY3DPEHPK3PXP');

    await db.insert(userTotp).values({ userId: uid, secretCiphertext: seededTotp });
    // Garbage that the migration will fail to decrypt — it is base64, but
    // not a well-formed nonce||ct||tag envelope under the OLD key.
    await db.insert(bankSyncCredentials).values({
      userId: uid,
      applicationId: 'app-broken',
      privateKeyEncrypted: Buffer.from('this-is-not-a-valid-envelope').toString('base64'),
    });

    await expect(migrateSessionSecret(OLD, NEW)).rejects.toThrow();

    const [row] = await db.select().from(userTotp).where(eq(userTotp.userId, uid));
    expect(row!.secretCiphertext).toBe(seededTotp);
  });
});
