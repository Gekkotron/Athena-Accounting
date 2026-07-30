import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/client.js';
import { bankConnections, bankConnectionAccounts, bankSyncCredentials } from '../../db/schema.js';
import { env } from '../../env.js';
import { markDirty } from '../../db/snapshotScheduler.js';
import { getCredentials } from '../bank-sync/store.js';
import {
  createEnableBankingClient,
  EnableBankingError,
  type EnableBankingClient,
} from '../../services/enable-banking/client.js';
import { runImport } from './import-service.js';
import { normalizeEbTransaction, syncWindowStart } from './bank-sync-core.js';

// Sync engine: pulls booked transactions for every mapped account of every
// active connection and feeds them through runImport, so dedup, rule
// categorization, transfer detection, and recurring detection apply
// unchanged. Consent problems (401/403/410 from Enable Banking, or a
// valid_until already in the past) flip the connection to needs_reconnect
// instead of erroring — the UI turns that status into a reconnect prompt.

const RECONNECT_STATUSES = new Set([401, 403, 410]);

// Sample of dedup-skipped rows carried back to the UI so the user can see
// WHAT was deduplicated, not just how many (same courtesy the file-import
// preview gives). Capped to bound the response size — dedupSkipped carries
// the true total.
const DEDUP_SAMPLE_MAX = 20;

export type AccountSyncResult = {
  bankAccountUid: string;
  accountId: number | null;
  imported: number;
  dedupSkipped: number;
  dedupSkippedRows: Array<{ date: string; amount: string; rawLabel: string }>;
  skipped: 'unmapped' | null;
};

export type ConnectionSyncResult = {
  connectionId: number;
  aspspName: string;
  status: 'ok' | 'needs_reconnect' | 'error';
  accounts: AccountSyncResult[];
  error?: string;
};

async function markNeedsReconnect(connectionId: number): Promise<void> {
  await db
    .update(bankConnections)
    .set({ status: 'needs_reconnect', updatedAt: new Date() })
    .where(eq(bankConnections.id, connectionId));
}

export async function syncUserConnections(
  userId: number,
  client: EnableBankingClient,
  opts?: { connectionId?: number },
): Promise<ConnectionSyncResult[]> {
  const conns = await db
    .select()
    .from(bankConnections)
    .where(
      opts?.connectionId !== undefined
        ? and(eq(bankConnections.userId, userId), eq(bankConnections.id, opts.connectionId))
        : eq(bankConnections.userId, userId),
    )
    .orderBy(asc(bankConnections.id));

  const todayIso = new Date().toISOString().slice(0, 10);
  const results: ConnectionSyncResult[] = [];

  for (const conn of conns) {
    // A connection already flagged, or whose consent window has lapsed, is
    // never retried against the bank — re-consent creates a new session.
    if (conn.status === 'needs_reconnect' || conn.validUntil < todayIso) {
      if (conn.status !== 'needs_reconnect') await markNeedsReconnect(conn.id);
      results.push({
        connectionId: conn.id,
        aspspName: conn.aspspName,
        status: 'needs_reconnect',
        accounts: [],
      });
      continue;
    }

    const accountRows = await db
      .select()
      .from(bankConnectionAccounts)
      .where(eq(bankConnectionAccounts.connectionId, conn.id))
      .orderBy(asc(bankConnectionAccounts.id));

    const result: ConnectionSyncResult = {
      connectionId: conn.id,
      aspspName: conn.aspspName,
      status: 'ok',
      accounts: [],
    };

    for (const row of accountRows) {
      if (row.accountId === null) {
        result.accounts.push({
          bankAccountUid: row.bankAccountUid,
          accountId: null,
          imported: 0,
          dedupSkipped: 0,
          dedupSkippedRows: [],
          skipped: 'unmapped',
        });
        continue;
      }
      try {
        const txs = await client.getAllTransactions(row.bankAccountUid, {
          dateFrom: syncWindowStart(row.lastSyncedAt),
        });
        const prepared = txs
          .map(normalizeEbTransaction)
          .filter((p): p is NonNullable<typeof p> => p !== null);
        let imported = 0;
        let dedupSkipped = 0;
        let dedupSkippedRows: AccountSyncResult['dedupSkippedRows'] = [];
        if (prepared.length > 0) {
          const r = await runImport({
            filename: `bank-sync ${conn.aspspName} ${row.iban ?? row.bankAccountUid} ${todayIso}`,
            accountId: row.accountId,
            userId,
            format: 'bank-sync',
            prepared,
          });
          imported = r.insertedCount;
          dedupSkipped = r.dedupSkipped;
          dedupSkippedRows = r.dedupSkippedRows.slice(0, DEDUP_SAMPLE_MAX);
        }
        await db
          .update(bankConnectionAccounts)
          .set({ lastSyncedAt: new Date() })
          .where(eq(bankConnectionAccounts.id, row.id));
        result.accounts.push({
          bankAccountUid: row.bankAccountUid,
          accountId: row.accountId,
          imported,
          dedupSkipped,
          dedupSkippedRows,
          skipped: null,
        });
      } catch (err) {
        if (err instanceof EnableBankingError && RECONNECT_STATUSES.has(err.status)) {
          await markNeedsReconnect(conn.id);
          result.status = 'needs_reconnect';
          break;
        }
        result.status = 'error';
        result.error = err instanceof Error ? err.message : String(err);
        break;
      }
    }

    results.push(result);
  }

  return results;
}

// --- Scheduler ---------------------------------------------------------------

// Nightly unattended sync, modeled on the watch-folder poller: overlap-
// guarded, unref'd, cleared onClose. First run is delayed after boot so a
// crash-looping process never hammers the Enable Banking API. Disabled with
// BANK_SYNC_AUTO=0 and never active under tests; a user with no stored
// credentials costs one SELECT per day.
const SYNC_INTERVAL_MS = 24 * 3_600_000;
const BOOT_DELAY_MS = 5 * 60_000;

export function startBankSyncScheduler(app: FastifyInstance): void {
  if (env.NODE_ENV === 'test' || !env.BANK_SYNC_AUTO) return;
  let running = false;
  const tick = (): void => {
    if (running) return;
    running = true;
    void (async () => {
      const credRows = await db
        .select({ userId: bankSyncCredentials.userId })
        .from(bankSyncCredentials);
      let imported = 0;
      for (const { userId } of credRows) {
        const creds = await getCredentials(userId);
        if (!creds) continue;
        const results = await syncUserConnections(userId, createEnableBankingClient(creds));
        for (const r of results) {
          for (const a of r.accounts) imported += a.imported;
          app.log.info(
            `[bank-sync] user=${userId} connection=${r.connectionId} (${r.aspspName}) ` +
              `status=${r.status} imported=${r.accounts.reduce((s, a) => s + a.imported, 0)}`,
          );
        }
      }
      // Scheduler writes bypass the HTTP onResponse hook that normally marks
      // the encrypted-snapshot scheduler dirty — do it here (no-op when
      // snapshots aren't active).
      if (imported > 0) markDirty();
    })()
      .catch((err) => app.log.error({ err }, '[bank-sync] scheduled sync failed'))
      .finally(() => {
        running = false;
      });
  };
  const boot = setTimeout(tick, BOOT_DELAY_MS);
  boot.unref();
  const handle = setInterval(tick, SYNC_INTERVAL_MS);
  handle.unref();
  app.addHook('onClose', async () => {
    clearTimeout(boot);
    clearInterval(handle);
  });
}
