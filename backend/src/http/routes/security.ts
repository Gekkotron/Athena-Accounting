import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { dataDir } from '../../dataDir.js';
import { dbDriver } from '../../db/client.js';
import { decryptBuffer, EnvelopeDecryptError } from '../../lib/binaryEnvelope.js';
import {
  clearEncryption, readMarker, readSnapshot, removeBackupSnapshot, writeMarker,
} from '../../db/snapshotStore.js';
import {
  activateSnapshots, deactivateSnapshots, snapshotNow,
} from '../../db/snapshotScheduler.js';

// Desktop encryption-at-rest control plane: enable / disable / change the
// passphrase that protects the debounced encrypted PGlite snapshot (see
// snapshotStore.ts + snapshotScheduler.ts). Postgres deployments never have
// a snapshot to encrypt, so every mutating route 400s off `dbDriver`.
const PasswordBody = z.object({ password: z.string().min(8).max(1024) });
const ChangeBody = z.object({
  oldPassword: z.string().min(8).max(1024),
  newPassword: z.string().min(8).max(1024),
});

// Shared by disable/change: proves the caller knows the passphrase currently
// protecting the on-disk snapshot by actually decrypting it. Maps a wrong
// passphrase to 403 and re-throws anything else (missing/corrupt snapshot)
// for the route to turn into a 400/500 as appropriate.
async function verifyPassword(dir: string, password: string): Promise<void> {
  const snapshot = await readSnapshot(dir);
  decryptBuffer(snapshot, password);
}

export async function securityRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.get('/api/security', async () => {
    const marker = await readMarker(dataDir());
    return {
      driver: dbDriver,
      encrypted: marker === 'encrypted',
      pendingDisable: marker === 'disable-pending',
    };
  });

  app.post('/api/security/enable', async (req, reply) => {
    const parsed = PasswordBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    if (dbDriver !== 'pglite') {
      return reply.code(400).send({ error: 'encryption requires the desktop (pglite) driver' });
    }
    const dir = dataDir();
    if ((await readMarker(dir)) === 'encrypted') {
      return reply.code(400).send({ error: 'already encrypted' });
    }

    const { password } = parsed.data;
    // activateSnapshots + snapshotNow run the real dump -> encrypt -> write
    // pipeline (snapshotScheduler.ts) under the candidate password. snapshotNow()
    // never rejects (it logs and swallows pipeline failures), so success is
    // only confirmed by reading the snapshot back and decrypting it below.
    activateSnapshots(password);
    await snapshotNow();

    try {
      await verifyPassword(dir, password);
    } catch {
      await clearEncryption(dir);
      deactivateSnapshots();
      return reply.code(500).send({ error: 'failed to write encrypted snapshot' });
    }

    await writeMarker(dir, 'encrypted');
    return { ok: true };
  });

  app.post('/api/security/disable', async (req, reply) => {
    const parsed = PasswordBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const dir = dataDir();
    if ((await readMarker(dir)) !== 'encrypted') {
      return reply.code(400).send({ error: 'encryption is not enabled' });
    }

    try {
      await verifyPassword(dir, parsed.data.password);
    } catch (err) {
      if (err instanceof EnvelopeDecryptError) {
        return reply.code(403).send({ error: 'wrong password' });
      }
      throw err;
    }

    // Actually turning encryption off (deactivateSnapshots + clearEncryption)
    // requires restarting with a plaintext boot — see Task 6 (locked boot).
    // This route only records the intent; the marker is consumed on next boot.
    await writeMarker(dir, 'disable-pending');
    return { ok: true, restartRequired: true };
  });

  app.post('/api/security/change', async (req, reply) => {
    const parsed = ChangeBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const dir = dataDir();
    if ((await readMarker(dir)) !== 'encrypted') {
      return reply.code(400).send({ error: 'encryption is not enabled' });
    }
    const { oldPassword, newPassword } = parsed.data;

    try {
      await verifyPassword(dir, oldPassword);
    } catch (err) {
      if (err instanceof EnvelopeDecryptError) {
        return reply.code(403).send({ error: 'wrong password' });
      }
      throw err;
    }

    // Same never-rejects caveat as /enable: snapshotNow() logs and swallows
    // pipeline failures, so a silent failure here would leave athena.db.enc
    // still encrypted under `oldPassword` while reporting success — the user's
    // new password would then fail to unlock on next boot. Verify by reading
    // the snapshot back and decrypting it under `newPassword`; on failure,
    // re-activate the old password and re-snapshot under it so the previous
    // password keeps working, rather than leaving the app in a state where
    // neither password is guaranteed to open the on-disk snapshot.
    activateSnapshots(newPassword);
    await snapshotNow();

    try {
      await verifyPassword(dir, newPassword);
    } catch {
      activateSnapshots(oldPassword);
      await snapshotNow();
      return reply.code(500).send({ error: 'password change failed — previous password still applies' });
    }

    // writeSnapshot()'s rotation just moved the pre-change snapshot — still
    // decryptable under `oldPassword` — into .bak. A password change must
    // actually revoke the old password's ability to open a copy of the
    // data, not just make the new one additionally work, so remove it now
    // that the new-password snapshot is confirmed good.
    await removeBackupSnapshot(dir);

    return { ok: true };
  });
}
