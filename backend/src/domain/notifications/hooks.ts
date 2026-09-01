import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { userSettings, accounts, transactions } from '../../db/schema.js';
import { mergeSettings } from '../settings/schema.js';
import { emitNotification } from './emit.js';
import { queueBatched, flushBatch } from './batcher.js';
import { computeEnvelope } from './envelope-check.js';

async function loadPrefs(userId: number) {
  const [row] = await db.select({ settings: userSettings.settings })
    .from(userSettings).where(eq(userSettings.userId, userId));
  return mergeSettings(row?.settings ?? {}).notifications;
}

// Current balance for an account: opening_balance + SUM(amount) for every
// transaction on/after opening_date — the same aggregate GET /api/accounts
// uses for `current_balance`. Called after the row(s) that triggered the
// check have already been inserted, so it reflects them.
export async function computeCurrentBalance(accountId: number): Promise<number> {
  const [account] = await db.select({ openingBalance: accounts.openingBalance, openingDate: accounts.openingDate })
    .from(accounts).where(eq(accounts.id, accountId));
  if (!account) return 0;
  const [sumRow] = await db.select({ sum: sql<string>`COALESCE(SUM(${transactions.amount}), 0)` })
    .from(transactions)
    .where(and(eq(transactions.accountId, accountId), gte(transactions.date, account.openingDate)));
  return Number(account.openingBalance) + Number(sumRow?.sum ?? 0);
}

export async function afterTransactionInserted(userId: number, tx: {
  id: number; accountId: number; amount: number; merchant: string | null; categoryId: number | null;
  newBalance: number;
}): Promise<void> {
  const prefs = await loadPrefs(userId);

  // big_transaction
  const threshold = prefs.triggers.bigTransaction.thresholds[String(tx.accountId)];
  if (prefs.triggers.bigTransaction.enabled && threshold != null && Math.abs(tx.amount) >= threshold) {
    queueBatched(userId, `bt:${tx.accountId}`, { accountId: tx.accountId, amount: Math.abs(tx.amount) });
  }

  // account_low
  const floor = prefs.triggers.accountLow.floors[String(tx.accountId)];
  if (prefs.triggers.accountLow.enabled && floor != null && tx.newBalance < floor) {
    const today = new Date().toISOString().slice(0, 10);
    await emitNotification(userId, 'account_low',
      { kind: 'account_low', accountId: tx.accountId, balance: tx.newBalance, floor },
      { idempotency: `low:${tx.accountId}:${today}` });
  }

  // envelope_exceeded — read current month's envelope spent for tx.categoryId
  if (prefs.triggers.envelopeExceeded.enabled && tx.categoryId != null) {
    const { spent, envelope, month } = await computeEnvelope(userId, tx.categoryId);
    if (envelope != null && spent > envelope) {
      await emitNotification(userId, 'envelope_exceeded',
        { kind: 'envelope_exceeded', categoryId: tx.categoryId, envelope, spent, month },
        { idempotency: `env:${tx.categoryId}:${month}` });
    }
  }
}

export async function afterBankSyncCompleted(userId: number, accountId: number, ok: boolean, reason?: string): Promise<void> {
  const prefs = await loadPrefs(userId);
  const today = new Date().toISOString().slice(0, 10);
  if (!ok && prefs.triggers.bankSyncFailed.enabled) {
    await emitNotification(userId, 'bank_sync_failed',
      { kind: 'bank_sync_failed', accountId, reason: reason ?? 'unknown' },
      { idempotency: `sync:${accountId}:${today}` });
  }
  // At end of sync, force-flush any accumulated big_transaction batches for accounts in this sync.
  await flushBatch(userId, `bt:${accountId}`);
}
