import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api/client';
import type { Account } from '../api/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SettingsBankSyncCredentials } from './SettingsBankSyncCredentials';
import { BankConnectionCard } from './BankConnectionCard';
import {
  consentRedirectUrl,
  extractAuthCode,
  type BankConnection,
  type BankSyncStatus,
  type SyncConnectionResult,
} from './SettingsBankSync-lib';

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

  const [saveOk, setSaveOk] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteMut = useMutation({
    mutationFn: () => api('/api/bank-sync/credentials', { method: 'DELETE' }),
    onSuccess: () => {
      setSaveOk(false);
      qc.invalidateQueries({ queryKey: ['bank-sync-status'] });
      qc.invalidateQueries({ queryKey: ['bank-sync-connections'] });
    },
  });

  // --- Connect flow ----------------------------------------------------------
  const [selectedBank, setSelectedBank] = useState('');
  const [connectError, setConnectError] = useState<string | null>(null);
  const connectMut = useMutation({
    mutationFn: (aspspName: string) =>
      api<{ url: string }>('/api/bank-sync/connect', { method: 'POST', json: { aspspName } }),
    onSuccess: ({ url }) => {
      window.location.assign(url);
    },
    onError: (err) => {
      // Surface the Enable Banking status when we have it — "generic error"
      // is undiagnosable from a screenshot.
      const upstream =
        err instanceof ApiError &&
        typeof (err.data as { upstreamStatus?: unknown } | null)?.upstreamStatus === 'number'
          ? ` (Enable Banking HTTP ${(err.data as { upstreamStatus: number }).upstreamStatus})`
          : '';
      setConnectError(t('settings.bankSync.errors.generic') + upstream);
    },
  });

  // --- Manual consent finalization --------------------------------------------
  // Fallback for when the bank's redirect lands on an unreachable page (the
  // whitelisted URL doesn't match the address Athena is browsed at): the user
  // pastes the final URL (or the bare code) and we exchange it here.
  const [manualInput, setManualInput] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualOk, setManualOk] = useState(false);
  const manualMut = useMutation({
    mutationFn: (code: string) => api('/api/bank-sync/sessions', { method: 'POST', json: { code } }),
    onSuccess: () => {
      setManualInput('');
      setManualError(null);
      setManualOk(true);
      qc.invalidateQueries({ queryKey: ['bank-sync-connections'] });
    },
    onError: () => {
      setManualOk(false);
      setManualError(t('settings.bankSync.manual.error'));
    },
  });
  function submitManual(): void {
    const code = extractAuthCode(manualInput);
    if (!code) {
      setManualOk(false);
      setManualError(t('settings.bankSync.manual.noCode'));
      return;
    }
    setManualError(null);
    manualMut.mutate(code);
  }

  // --- Per-connection actions ------------------------------------------------
  const [syncResults, setSyncResults] = useState<Record<number, SyncConnectionResult>>({});
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const syncMut = useMutation({
    mutationFn: (connectionId: number) =>
      api<{ results: SyncConnectionResult[] }>('/api/bank-sync/sync', {
        method: 'POST',
        json: { connectionId },
      }),
    onSuccess: ({ results }) => {
      const r = results[0];
      if (r) setSyncResults((prev) => ({ ...prev, [r.connectionId]: r }));
      qc.invalidateQueries({ queryKey: ['bank-sync-connections'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      // Same refreshes a file import triggers: the sync wrote an audit row,
      // may have created fresh duplicate clusters, and moved every aggregate.
      qc.invalidateQueries({ queryKey: ['imports'] });
      qc.invalidateQueries({ queryKey: ['transaction-duplicates'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      qc.invalidateQueries({ queryKey: ['tri-groups'] });
    },
    onSettled: () => setSyncingId(null),
  });

  const mappingMut = useMutation({
    mutationFn: (input: { connectionId: number; bankAccountUid: string; accountId: number | null }) =>
      api(`/api/bank-sync/connections/${input.connectionId}/mappings`, {
        method: 'PUT',
        json: { mappings: [{ bankAccountUid: input.bankAccountUid, accountId: input.accountId }] },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bank-sync-connections'] }),
  });

  const [confirmDisconnect, setConfirmDisconnect] = useState<BankConnection | null>(null);
  const disconnectMut = useMutation({
    mutationFn: (connectionId: number) =>
      api(`/api/bank-sync/connections/${connectionId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bank-sync-connections'] }),
  });

  const redirectUrl = consentRedirectUrl(window.location.origin);

  return (
    <section data-testid="bank-sync-section" className="flex flex-col gap-4 pt-4 border-t border-ink-800/60">
      <div>
        <div className="label">{t('settings.bankSync.sectionLabel')}</div>
        <p className="text-sm text-ink-400 mt-1">{t('settings.bankSync.description')}</p>
      </div>

      {!configured && (
        <SettingsBankSyncCredentials
          redirectUrl={redirectUrl}
          onSaved={() => {
            setSaveOk(true);
            qc.invalidateQueries({ queryKey: ['bank-sync-status'] });
          }}
        />
      )}

      {configured && (
        <>
          {saveOk && (
            <div className="rounded-lg border border-sage-800/50 bg-sage-900/15 px-3 py-2 text-sm text-sage-200">
              {t('settings.bankSync.saveSuccess')}
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-ink-400">
              {t('settings.bankSync.configuredAs', { id: statusQ.data?.applicationId ?? '' })}
            </p>
            <button type="button" className="btn-ghost" onClick={() => setConfirmDelete(true)}>
              {t('settings.bankSync.deleteCredentials')}
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <div className="label">{t('settings.bankSync.connect.label')}</div>
            <div className="flex items-center gap-2">
              <select
                className="input flex-1"
                aria-label={t('settings.bankSync.connect.label')}
                value={selectedBank}
                onChange={(e) => setSelectedBank(e.target.value)}
              >
                <option value="">{t('settings.bankSync.connect.bankPlaceholder')}</option>
                {(aspspsQ.data?.aspsps ?? []).map((a) => (
                  <option key={a.name} value={a.name}>
                    {a.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn-primary"
                disabled={!selectedBank || connectMut.isPending}
                onClick={() => {
                  setConnectError(null);
                  connectMut.mutate(selectedBank);
                }}
              >
                {t('settings.bankSync.connect.button')}
              </button>
            </div>
            <p className="text-xs text-ink-400">{t('settings.bankSync.connect.hint')}</p>
            {connectError && (
              <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200">
                {connectError}
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
                    value={manualInput}
                    onChange={(e) => setManualInput(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={manualInput.trim() === '' || manualMut.isPending}
                    onClick={submitManual}
                  >
                    {t('settings.bankSync.manual.button')}
                  </button>
                </div>
                {manualError && (
                  <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200">
                    {manualError}
                  </div>
                )}
                {manualOk && (
                  <div className="rounded-lg border border-sage-800/50 bg-sage-900/15 px-3 py-2 text-sm text-sage-200">
                    {t('settings.bankSync.manual.success')}
                  </div>
                )}
              </div>
            </details>
          </div>

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
                result={syncResults[conn.id]}
                syncing={syncMut.isPending && syncingId === conn.id}
                reconnectPending={connectMut.isPending}
                onSync={() => {
                  setSyncingId(conn.id);
                  syncMut.mutate(conn.id);
                }}
                onReconnect={() => connectMut.mutate(conn.aspspName)}
                onDisconnect={() => setConfirmDisconnect(conn)}
                onMap={(bankAccountUid, accountId) =>
                  mappingMut.mutate({ connectionId: conn.id, bankAccountUid, accountId })
                }
              />
            ))}
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={t('settings.bankSync.deleteDialogTitle')}
        description={t('settings.bankSync.deleteDialogDescription')}
        onConfirm={() => {
          deleteMut.mutate();
          setConfirmDelete(false);
        }}
        onCancel={() => setConfirmDelete(false)}
      />
      <ConfirmDialog
        open={confirmDisconnect !== null}
        title={t('settings.bankSync.connections.disconnectDialogTitle', {
          name: confirmDisconnect?.aspspName ?? '',
        })}
        description={t('settings.bankSync.connections.disconnectDialogDescription')}
        onConfirm={() => {
          if (confirmDisconnect) disconnectMut.mutate(confirmDisconnect.id);
          setConfirmDisconnect(null);
        }}
        onCancel={() => setConfirmDisconnect(null)}
      />
    </section>
  );
}
