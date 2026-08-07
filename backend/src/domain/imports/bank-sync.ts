import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/client.js';
import {
  bankConnections,
  bankConnectionAccounts,
  bankSyncCredentials,
  transactions,
  userSettings,
} from '../../db/schema.js';
import { env } from '../../env.js';
import { markDirty } from '../../db/snapshotScheduler.js';
import { getCredentials } from '../bank-sync/store.js';
import {
  createEnableBankingClient,
  EnableBankingError,
  type EnableBankingClient,
} from '../../services/enable-banking/client.js';
import { runImport } from './import-service.js';
import {
  firstSyncStart,
  isAutoSyncDue,
  normalizeEbTransaction,
  syncWindowStart,
} from './bank-sync-core.js';
import { mergeSettings } from '../settings/schema.js';

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

// Newest existing transaction on the target account — the first-sync
// boundary (see firstSyncStart in bank-sync-core.ts).
async function latestTransactionDate(userId: number, accountId: number): Promise<string | null> {
  const [row] = await db
    .select({ maxDate: sql<string | null>`max(${transactions.date})` })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.accountId, accountId)));
  return row?.maxDate ?? null;
}

// Newest lastSyncedAt across the user's mapped accounts, in ms epoch. Used
// to seed the scheduler's in-memory lastAttempt map on first observation so
// a container rebuild after today's scheduled sync does not clear that gate
// and re-fire catch-up. undefined when no account has ever synced.
async function latestAttemptMsFor(userId: number): Promise<number | undefined> {
  const [row] = await db
    .select({
      lastMs: sql<
        string | null
      >`extract(epoch from max(${bankConnectionAccounts.lastSyncedAt})) * 1000`,
    })
    .from(bankConnectionAccounts)
    .innerJoin(bankConnections, eq(bankConnectionAccounts.connectionId, bankConnections.id))
    .where(eq(bankConnections.userId, userId));
  const raw = row?.lastMs;
  if (raw === null || raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = PgTransaction<any, any, any>;

// Deleting a bank-sync import batch (Données → Imports) removes its rows —
// the next sync must re-baseline instead of resuming from lastSyncedAt,
// otherwise the overlap window would re-import rows that no longer dedup
// against anything. Called from the imports DELETE route inside its
// transaction.
export async function resetSyncBaseline(tx: Tx, userId: number, accountId: number): Promise<void> {
  await tx
    .update(bankConnectionAccounts)
    .set({ lastSyncedAt: null })
    .where(
      and(
        eq(bankConnectionAccounts.accountId, accountId),
        inArray(
          bankConnectionAccounts.connectionId,
          tx.select({ id: bankConnections.id }).from(bankConnections).where(eq(bankConnections.userId, userId)),
        ),
      ),
    );
}

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
        // First sync for this mapping starts after the newest existing
        // transaction (cross-source dedup is impossible — see core helper);
        // subsequent syncs overlap 7 days and self-dedup on the API's refs.
        const dateFrom = row.lastSyncedAt
          ? syncWindowStart(row.lastSyncedAt)
          : firstSyncStart(await latestTransactionDate(userId, row.accountId));
        const txs = await client.getAllTransactions(row.bankAccountUid, { dateFrom });
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

// Unattended sync at the user-configured local hour (settings.bankSyncHour,
// default 02:00). The loop ticks every 15 minutes and applies catch-up
// dueness (see isAutoSyncDue): an always-on server syncs within one tick of
// the configured hour; a desktop app that was closed overnight catches up on
// the first tick after launch. Overlap-guarded, unref'd, cleared onClose.
// First tick is delayed after boot so a crash-looping process never hammers
// the Enable Banking API. Disabled with BANK_SYNC_AUTO=0 and never active
// under tests; a user with no stored credentials costs one SELECT per tick.
const TICK_INTERVAL_MS = 15 * 60_000;
const BOOT_DELAY_MS = 5 * 60_000;

async function syncHourFor(uid: number): Promise<number> {
  const [row] = await db
    .select({ settings: userSettings.settings })
    .from(userSettings)
    .where(eq(userSettings.userId, uid));
  return mergeSettings(row?.settings ?? {}).bankSyncHour;
}

export function startBankSyncScheduler(app: FastifyInstance): void {
  if (env.NODE_ENV === 'test' || !env.BANK_SYNC_AUTO) return;
  let running = false;
  // Per-user last attempt, ms epoch. In-memory, but seeded on first
  // observation from the newest persisted lastSyncedAt across the user's
  // mapped accounts — without that seed, a container rebuild after today's
  // scheduled sync would clear the map and the 5-min post-boot tick would
  // catch-up-fire an unwanted second sync. A user whose accounts have never
  // synced seeds to undefined, so the very first sync still fires.
  const lastAttempt = new Map<number, number>();
  const seededFromDb = new Set<number>();
  const tick = (): void => {
    if (running) return;
    running = true;
    void (async () => {
      const credRows = await db
        .select({ userId: bankSyncCredentials.userId })
        .from(bankSyncCredentials);
      let imported = 0;
      const now = new Date();
      for (const { userId } of credRows) {
        const hour = await syncHourFor(userId);
        if (!seededFromDb.has(userId)) {
          const seed = await latestAttemptMsFor(userId);
          if (seed !== undefined) lastAttempt.set(userId, seed);
          seededFromDb.add(userId);
        }
        if (!isAutoSyncDue(hour, now, lastAttempt.get(userId))) continue;
        lastAttempt.set(userId, now.getTime());
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
  const handle = setInterval(tick, TICK_INTERVAL_MS);
  handle.unref();
  app.addHook('onClose', async () => {
    clearTimeout(boot);
    clearInterval(handle);
  });
}
