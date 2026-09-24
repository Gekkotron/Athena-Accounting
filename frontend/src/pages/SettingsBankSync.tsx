import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import type { Account } from '../api/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorState, LoadingBlock } from '../components/StateBlocks';
import { SettingsBankSyncCredentials } from './SettingsBankSyncCredentials';
import { BankConnectionCard } from './BankConnectionCard';
import { BankSyncSchedule } from './BankSyncSchedule';
import { formatDate } from '../lib/format';
import { todayLocalIso } from '../lib/dates';
import {
  consentRedirectUrl,
  soonestExpiring,
  type BankConnection,
  type BankSyncStatus,
} from './SettingsBankSync-lib';
import { useBankSyncActions } from './useBankSyncActions';

export function SettingsBankSync({ accounts }: { accounts: Account[] }): JSX.Element {
  const { t } = useTranslation('settings');
  const qc = useQueryClient();

  const statusQ = useQuery({
    queryKey: ['bank-sync-status'],
    queryFn: () => api<BankSyncStatus>('/api/bank-sync/status'),
  });
  const configured = statusQ.data?.configured === true;

  const connectionsQ = useQuery({
    queryKey: ['bank-sync-connections'],
    queryFn: () => api<{ connections: BankConnection[] }>('/api/bank-sync/connections'),
    enabled: configured,
  });
  const connections = connectionsQ.data?.connections ?? [];

  const aspspsQ = useQuery({
    queryKey: ['bank-sync-aspsps'],
    queryFn: () => api<{ aspsps: Array<{ name: string; country: string }> }>('/api/bank-sync/aspsps'),
    enabled: configured,
    staleTime: 3_600_000,
  });

  const a = useBankSyncActions();

  const redirectUrl = consentRedirectUrl(window.location.origin);
  const expiring = soonestExpiring(connections, todayLocalIso());

  return (
    <section data-testid="bank-sync-section" className="flex flex-col gap-4">
      <p className="text-sm text-ink-400">{t('settings.bankSync.description')}</p>

      {statusQ.isLoading && <LoadingBlock height="min-h-32" />}
      {statusQ.isError && (
        <ErrorState title={t('settings.bankSync.statusError')} error={statusQ.error} onRetry={() => void statusQ.refetch()} />
      )}

      {statusQ.data && !configured && (
        <SettingsBankSyncCredentials
          redirectUrl={redirectUrl}
          onSaved={() => {
            a.setSaveOk(true);
            qc.invalidateQueries({ queryKey: ['bank-sync-status'] });
          }}
        />
      )}

      {statusQ.data && configured && (
        <>
          {a.saveOk && (
            <div className="rounded-lg border border-sage-800/50 bg-sage-900/15 px-3 py-2 text-sm text-sage-200">
              {t('settings.bankSync.saveSuccess')}
            </div>
          )}
          {expiring && (
            <div
              data-testid="bank-sync-expiry-banner"
              className="rounded-lg border border-amber-800/50 bg-amber-900/25 px-3 py-2 text-sm text-amber-200"
            >
              {t('settings.bankSync.expiryBanner', {
                name: expiring.aspspName,
                date: formatDate(expiring.validUntil),
              })}
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-ink-400">
              {t('settings.bankSync.configuredAs', { id: statusQ.data?.applicationId ?? '' })}
            </p>
            <button type="button" className="btn-ghost" onClick={() => a.setConfirmDelete(true)}>
              {t('settings.bankSync.deleteCredentials')}
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <div className="label">{t('settings.bankSync.connect.label')}</div>
            <div className="flex items-center gap-2">
              <select
                className="input flex-1"
                aria-label={t('settings.bankSync.connect.label')}
                value={a.selectedBank}
                onChange={(e) => a.setSelectedBank(e.target.value)}
              >
                <option value="">{t('settings.bankSync.connect.bankPlaceholder')}</option>
                {(aspspsQ.data?.aspsps ?? []).map((asp) => (
                  <option key={asp.name} value={asp.name}>
                    {asp.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn-primary"
                disabled={!a.selectedBank || a.connectMut.isPending}
                onClick={() => {
                  a.setConnectError(null);
                  a.connectMut.mutate(a.selectedBank);
                }}
              >
                {t('settings.bankSync.connect.button')}
              </button>
            </div>
            <p className="text-xs text-ink-400">{t('settings.bankSync.connect.hint')}</p>
            {a.connectError && (
              <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200">
                {a.connectError}
              </div>
            )}
            <details className="mt-1">
              <summary className="text-xs text-ink-400 cursor-pointer select-none">
                {t('settings.bankSync.manual.summary')}
              </summary>
              <div className="flex flex-col gap-2 mt-2">
                <p className="text-xs text-ink-400">{t('settings.bankSync.manual.help')}</p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    className="input flex-1"
                    aria-label={t('settings.bankSync.manual.inputLabel')}
                    placeholder={t('settings.bankSync.manual.placeholder')}
                    value={a.manualInput}
                    onChange={(e) => a.setManualInput(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={a.manualInput.trim() === '' || a.manualMut.isPending}
                    onClick={a.submitManual}
                  >
                    {t('settings.bankSync.manual.button')}
                  </button>
                </div>
                {a.manualError && (
                  <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200">
                    {a.manualError}
                  </div>
                )}
                {a.manualOk && (
                  <div className="rounded-lg border border-sage-800/50 bg-sage-900/15 px-3 py-2 text-sm text-sage-200">
                    {t('settings.bankSync.manual.success')}
                  </div>
                )}
              </div>
            </details>
          </div>

          <BankSyncSchedule auto={statusQ.data?.autoSync} />

          <div className="flex flex-col gap-3">
            <div className="label">{t('settings.bankSync.connections.label')}</div>
            {connections.length === 0 && (
              <p className="text-sm text-ink-400">{t('settings.bankSync.connections.empty')}</p>
            )}
            {connections.map((conn) => (
              <BankConnectionCard
                key={conn.id}
                conn={conn}
                accounts={accounts}
                result={a.syncResults[conn.id]}
                syncing={a.syncMut.isPending && a.syncingId === conn.id}
                reconnectPending={a.connectMut.isPending}
                onSync={() => {
                  a.setSyncingId(conn.id);
                  a.syncMut.mutate(conn.id);
                }}
                onReconnect={() => a.connectMut.mutate(conn.aspspName)}
                onDisconnect={() => a.setConfirmDisconnect(conn)}
                onMap={(bankAccountUid, accountId) =>
                  a.mappingMut.mutate({ connectionId: conn.id, bankAccountUid, accountId })
                }
              />
            ))}
          </div>
        </>
      )}

      <ConfirmDialog
        open={a.confirmDelete}
        title={t('settings.bankSync.deleteDialogTitle')}
        description={t('settings.bankSync.deleteDialogDescription')}
        onConfirm={() => {
          a.deleteMut.mutate();
          a.setConfirmDelete(false);
        }}
        onCancel={() => a.setConfirmDelete(false)}
      />
      <ConfirmDialog
        open={a.confirmDisconnect !== null}
        title={t('settings.bankSync.connections.disconnectDialogTitle', {
          name: a.confirmDisconnect?.aspspName ?? '',
        })}
        description={t('settings.bankSync.connections.disconnectDialogDescription')}
        onConfirm={() => {
          if (a.confirmDisconnect) a.disconnectMut.mutate(a.confirmDisconnect.id);
          a.setConfirmDisconnect(null);
        }}
        onCancel={() => a.setConfirmDisconnect(null)}
      />
    </section>
  );
}
