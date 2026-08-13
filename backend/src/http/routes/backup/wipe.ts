import { eq, sql } from 'drizzle-orm';
import type { db } from '../../../db/client.js';
import {
  accounts,
  accountFilenamePatterns,
  balanceCheckpoints,
  categories,
  categoryBudgets,
  fileImports,
  rules,
  transactionAttachments,
  transactions,
  transactionSplits,
  users,
} from '../../../db/schema.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Restore's REPLACE-semantics wipe.
//
// Sole-user installs (the desktop app always; solo LAN setups) wipe via
// TRUNCATE instead of per-user DELETEs. Beyond being O(1), this is a
// PGlite-survival requirement: a DELETE that visits a tuple whose xmax was
// written by a crashed session busy-waits forever in single-user WASM
// Postgres (observed as a restore pinned at 100% CPU). TRUNCATE swaps the
// relation's storage without inspecting tuples, so it is immune. The list
// mirrors what the DELETE path removes directly or via FK cascade
// (recurring_series husks additionally go — they'd only survive as empty
// shells with dead transaction links). user_settings and
// envelope_month_holds reference only users and are kept by both paths.
export async function wipeUserData(tx: Tx, uid: number): Promise<void> {
  const [userCount] = await tx.select({ n: sql<number>`count(*)::int` }).from(users);
  if ((userCount?.n ?? 0) === 1) {
    await tx.execute(sql`TRUNCATE
      transaction_splits, transaction_attachments,
      recurring_series_transactions, recurring_series,
      envelope_assignments, envelope_category_settings,
      pdf_import_drafts, pdf_statement_templates,
      transactions, file_imports, rules,
      balance_checkpoints, category_budgets, account_filename_patterns,
      categories, accounts CASCADE`);
    return;
  }

  // Wipe only THIS user's rows, in reverse dependency order.
  // Splits and attachments both cascade-delete when the parent transactions
  // go, but we drop them explicitly to keep the ordering readable. Orphan
  // attachment files on disk (DATA_DIR/attachments/<user_id>/…) are NOT
  // cleaned up here — the on-disk sweep is out of scope for the wipe path;
  // see backup/schema.ts for the deferred-attachments rationale.
  await tx.delete(transactionAttachments).where(eq(transactionAttachments.userId, uid));
  await tx.delete(transactionSplits)
    .where(sql`transaction_id IN (SELECT id FROM transactions WHERE user_id = ${uid})`);
  await tx.delete(transactions).where(eq(transactions.userId, uid));
  await tx.delete(fileImports).where(eq(fileImports.userId, uid));
  await tx.delete(rules).where(eq(rules.userId, uid));
  await tx.delete(balanceCheckpoints).where(eq(balanceCheckpoints.userId, uid));
  await tx.delete(categoryBudgets).where(eq(categoryBudgets.userId, uid));
  await tx.delete(accountFilenamePatterns).where(eq(accountFilenamePatterns.userId, uid));
  await tx.delete(categories).where(eq(categories.userId, uid));
  await tx.delete(accounts).where(eq(accounts.userId, uid));
}
