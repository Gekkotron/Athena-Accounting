import { useTranslation } from 'react-i18next';
import type { Account } from '../api/types';
import { formatDate } from '../lib/format';
import { todayLocalIso } from '../lib/dates';
import {
  bankAccountLabel,
  connectionChipState,
  type BankConnection,
  type SyncConnectionResult,
} from './SettingsBankSync-lib';

// One card per bank connection: consent-lifecycle chip, per-account mapping
// selects, sync/reconnect/disconnect actions, and the last sync's outcome.
export function BankConnectionCard({
  conn,
  accounts,
  result,
  syncing,
  reconnectPending,
  onSync,
  onReconnect,
  onDisconnect,
  onMap,
}: {
  conn: BankConnection;
  accounts: Account[];
  result: SyncConnectionResult | undefined;
  syncing: boolean;
  reconnectPending: boolean;
  onSync: () => void;
  onReconnect: () => void;
  onDisconnect: () => void;
  onMap: (bankAccountUid: string, accountId: number | null) => void;
}): JSX.Element {
  const { t } = useTranslation('settings');
  const todayIso = todayLocalIso();
  const chip = connectionChipState(conn.status, conn.validUntil, todayIso);

  return (
    <div className="rounded-lg border border-ink-800/60 p-3 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm text-ink-100 font-medium">{conn.aspspName}</span>
          {chip === 'ok' && (
            <span className="text-xs rounded-full px-2 py-0.5 bg-sage-900/30 text-sage-200 border border-sage-800/50">
              {t('settings.bankSync.connections.connectedUntil', { date: formatDate(conn.validUntil) })}
            </span>
          )}
          {chip === 'soon' && (
            <span className="text-xs rounded-full px-2 py-0.5 bg-amber-900/25 text-amber-200 border border-amber-800/50">
              {t('settings.bankSync.connections.reconnectBefore', { date: formatDate(conn.validUntil) })}
            </span>
          )}
          {chip === 'required' && (
            <span
              data-testid={`bank-sync-reconnect-chip-${conn.id}`}
              className="text-xs rounded-full px-2 py-0.5 bg-clay-900/30 text-clay-200 border border-clay-800/60"
            >
              {t('settings.bankSync.connections.reconnectRequired')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {chip !== 'ok' && (
            <button type="button" className="btn-primary" disabled={reconnectPending} onClick={onReconnect}>
              {t('settings.bankSync.connections.reconnectButton')}
            </button>
          )}
          {chip !== 'required' && (
            <button type="button" className="btn-ghost" disabled={syncing} onClick={onSync}>
              {syncing
                ? t('settings.bankSync.connections.syncing')
                : t('settings.bankSync.connections.syncButton')}
            </button>
          )}
          <button type="button" className="btn-ghost" onClick={onDisconnect}>
            {t('settings.bankSync.connections.disconnectButton')}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {conn.accounts.map((a) => (
          <div key={a.bankAccountUid} className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-ink-200 flex-1 min-w-40">{bankAccountLabel(a)}</span>
            <select
              className="input max-w-64"
              aria-label={`${t('settings.bankSync.connections.mappingLabel')} ${bankAccountLabel(a)}`}
              value={a.accountId === null ? '' : String(a.accountId)}
              onChange={(e) => onMap(a.bankAccountUid, e.target.value === '' ? null : Number(e.target.value))}
            >
              <option value="">{t('settings.bankSync.connections.unmapped')}</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name} ({acc.currency})
                </option>
              ))}
            </select>
            {a.lastSyncedAt && (
              <span className="text-xs text-ink-400">
                {t('settings.bankSync.connections.lastSynced', { date: formatDate(a.lastSyncedAt.slice(0, 10)) })}
              </span>
            )}
          </div>
        ))}
      </div>

      {result && result.status === 'ok' && (
        <div className="rounded-lg border border-sage-800/50 bg-sage-900/15 px-3 py-2 text-sm text-sage-200">
          {t('settings.bankSync.connections.syncResult', {
            imported: result.accounts.reduce((s, a) => s + a.imported, 0),
            deduped: result.accounts.reduce((s, a) => s + a.dedupSkipped, 0),
          })}
          {(() => {
            const rows = result.accounts.flatMap((a) => a.dedupSkippedRows ?? []);
            const total = result.accounts.reduce((s, a) => s + a.dedupSkipped, 0);
            if (rows.length === 0) return null;
            return (
              <details className="mt-2">
                <summary className="cursor-pointer select-none text-xs text-sage-300">
                  {t('settings.bankSync.connections.duplicatesSummary', { count: total })}
                </summary>
                <ul className="mt-1 flex flex-col gap-0.5 text-xs text-ink-300 font-mono">
                  {rows.map((r, i) => (
                    <li key={i} className="truncate">
                      {r.date} · {r.rawLabel} · {r.amount}
                    </li>
                  ))}
                  {total > rows.length && (
                    <li className="text-ink-400">
                      {t('settings.bankSync.connections.duplicatesMore', { count: total - rows.length })}
                    </li>
                  )}
                </ul>
              </details>
            );
          })()}
        </div>
      )}
      {result && result.status !== 'ok' && (
        <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200">
          {result.status === 'needs_reconnect'
            ? t('settings.bankSync.connections.reconnectRequired')
            : t('settings.bankSync.errors.generic')}
          {result.status === 'error' && result.error && (
            <div className="mt-1 text-xs font-mono text-clay-300 break-all">{result.error}</div>
          )}
        </div>
      )}
    </div>
  );
}
