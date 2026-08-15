import type { FastifyInstance } from 'fastify';
import { db } from '../../../db/client.js';
import { userId } from '../../plugins/auth.js';
import { wipeUserData } from './wipe.js';
import { BackupBody } from './schema.js';
import { decryptEnvelope, isEncryptedEnvelope } from './crypto.js';
import { flushSnapshots } from '../../../db/snapshotScheduler.js';
import {
  restoreAccounts,
  restoreBalanceCheckpoints,
  restoreBudgets,
  restoreCategoryTree,
  restoreFilenamePatterns,
  restoreRules,
} from './restore-steps.js';
import {
  restoreFileImports,
  restoreSavingsGoalsAndEvents,
  restoreTransactions,
} from './restore-transactions.js';

// REPLACE semantics, scoped to the calling user only. Wipes only the caller's
// rows (via WHERE user_id = $uid) and reinserts every row from the dump with
// that user_id stamped. Other users' data is untouched.
export function registerRestoreRoute(app: FastifyInstance): void {
  app.post('/api/backup/import', {
    bodyLimit: 50 * 1024 * 1024,
  }, async (req, reply) => {
    const uid = userId(req);
    // Encrypted (enc1) files arrive as the envelope plus a sibling
    // `passphrase` field. Decrypt-and-reparse happens BEFORE the wipe
    // transaction below, so a wrong passphrase can never destroy data.
    let payload: unknown = req.body;
    if (isEncryptedEnvelope(payload)) {
      const pass = (req.body as Record<string, unknown>).passphrase;
      if (typeof pass !== 'string' || pass.length < 8) {
        return reply.code(400).send({ error: 'passphrase required for an encrypted backup' });
      }
      try {
        payload = JSON.parse(decryptEnvelope(payload, pass));
      } catch {
        // Wrong passphrase, tampered file, or non-JSON plaintext — GCM
        // can't distinguish and neither should the client-facing error.
        return reply.code(400).send({ error: 'wrong passphrase or corrupted backup file' });
      }
    }
    const parsed = BackupBody.safeParse(payload);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid backup format',
        issues: parsed.error.issues,
      });
    }
    const dump = parsed.data;

    const result = await db.transaction(async (tx) => {
      // TRUNCATE when solo, per-user DELETEs otherwise — see wipe.ts for the
      // PGlite busy-wait rationale.
      await wipeUserData(tx, uid);

      const accountIdByName = await restoreAccounts(tx, uid, dump.accounts);
      const cats = await restoreCategoryTree(tx, uid, dump.categories);
      await restoreFilenamePatterns(tx, uid, dump.accountFilenamePatterns, accountIdByName);
      const rulesInserted = await restoreRules(tx, uid, dump.rules, cats);
      // transferRules were removed as a feature — any values present in an
      // older dump are silently dropped on restore.
      const checkpointsInserted = await restoreBalanceCheckpoints(tx, uid, dump.balanceCheckpoints ?? [], accountIdByName);
      const budgetsInserted = await restoreBudgets(tx, uid, dump.budgets ?? [], accountIdByName, cats, req.log);
      const { map: fileImportIdByKey, count: fileImportsInserted } =
        await restoreFileImports(tx, uid, dump.fileImports ?? [], accountIdByName);
      const txCount = await restoreTransactions(tx, uid, dump.transactions, accountIdByName, cats, fileImportIdByKey);
      const goals = await restoreSavingsGoalsAndEvents(
        tx,
        uid,
        dump.savingsGoals ?? [],
        dump.savingsGoalEvents ?? [],
        accountIdByName,
      );

      return {
        imported: {
          accounts: accountIdByName.size,
          categories: cats.categoryIdByPath.size,
          accountFilenamePatterns: dump.accountFilenamePatterns.length,
          rules: rulesInserted,
          balanceCheckpoints: checkpointsInserted,
          budgets: budgetsInserted,
          transactions: txCount,
          fileImports: fileImportsInserted,
          savingsGoals: goals.goalsInserted,
          savingsGoalEvents: goals.eventsInserted,
        },
        skipped: {
          savingsGoals: goals.goalsSkipped,
          savingsGoalEvents: goals.eventsSkipped,
        },
      };
    });

    // A restore replaces the entire dataset in one transaction — the
    // debounced onResponse hook (buildServer.ts) would still cover it on its
    // own 10s-60s schedule, but a restore is exactly the kind of
    // all-or-nothing event the spec wants captured immediately rather than
    // left exposed to that window. Fire-and-forget: flushSnapshots() is a
    // cheap no-op when snapshots aren't active, and the reply shouldn't wait
    // on the encrypt+write pipeline.
    void flushSnapshots();

    return reply.code(200).send(result);
  });
}
