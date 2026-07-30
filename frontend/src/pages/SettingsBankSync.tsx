import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api/client';
import type { Account } from '../api/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { formatDate } from '../lib/format';
import {
  bankAccountLabel,
  connectionChipState,
  extractAuthCode,
  type BankConnection,
  type BankSyncStatus,
  type SyncConnectionResult,
} from './SettingsBankSync-lib';

function describeSaveError(err: unknown, t: (key: string) => string): string {
  if (err instanceof ApiError) {
    if (err.message === 'invalid private key') return t('settings.bankSync.errors.invalidKey');
    if (err.status === 502) return t('settings.bankSync.errors.rejected');
  }
  return t('settings.bankSync.errors.generic');
}

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

  // --- Credentials form ------------------------------------------------------
  const [applicationId, setApplicationId] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);
  const saveMut = useMutation({
    mutationFn: (input: { applicationId: string; privateKey: string }) =>
      api('/api/bank-sync/credentials', { method: 'PUT', json: input }),
    onSuccess: () => {
      setApplicationId('');
      setPrivateKey('');
      setSaveError(null);
      setSaveOk(true);
      qc.invalidateQueries({ queryKey: ['bank-sync-status'] });
    },
    onError: (err) => {
      setSaveOk(false);
      setSaveError(describeSaveError(err, t));
    },
  });
  const saveValid = applicationId.trim().length > 0 && privateKey.trim().length > 0;
  function submitCredentials(e: FormEvent) {
    e.preventDefault();
    if (!saveValid || saveMut.isPending) return;
    saveMut.mutate({ applicationId: applicationId.trim(), privateKey: privateKey.trim() });
  }

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
    onError: () => setConnectError(t('settings.bankSync.errors.generic')),
  });

  // --- Manual consent finalization --------------------------------------------
  // Fallback for when the bank's redirect lands on an unreachable page (the
  // whitelisted URL doesn't match the address Athena is browsed at): the user
  // pastes the final URL (or the bare code) and we exchange it here.
  const [manualInput, setManualInput] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualOk, setManualOk] = useState(false);
  const manualMut = useMutation({
    mutationFn: (code: string) =>
      api('/api/bank-sync/sessions', { method: 'POST', json: { code } }),
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

  const todayIso = new Date().toISOString().slice(0, 10);
  const redirectUrl = `${window.location.origin}/bank-sync/callback`;

  return (
    <section data-testid="bank-sync-section" className="flex flex-col gap-4 pt-4 border-t border-ink-800/60">
      <div>
        <div className="label">{t('settings.bankSync.sectionLabel')}</div>
        <p className="text-sm text-ink-400 mt-1">{t('settings.bankSync.description')}</p>
      </div>

      {!configured && (
        <form onSubmit={submitCredentials} className="flex flex-col gap-3">
          <p className="text-sm text-ink-400">{t('settings.bankSync.guide')}</p>
          <p className="text-sm text-ink-400">
            {t('settings.bankSync.redirectUrlLabel')}{' '}
            <code className="text-ink-200 break-all">{redirectUrl}</code>
          </p>
          <div>
            <label htmlFor="bank-sync-app-id" className="label mb-1.5 block">
              {t('settings.bankSync.applicationIdLabel')}
            </label>
            <input
              id="bank-sync-app-id"
              type="text"
              className="input"
              value={applicationId}
              onChange={(e) => setApplicationId(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div>
            <label htmlFor="bank-sync-private-key" className="label mb-1.5 block">
              {t('settings.bankSync.privateKeyLabel')}
            </label>
            <textarea
              id="bank-sync-private-key"
              className="input min-h-28 font-mono text-xs"
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              placeholder={t('settings.bankSync.privateKeyPlaceholder')}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          {saveError && (
            <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200">
              {saveError}
            </div>
          )}
          <button className="btn-primary" disabled={!saveValid || saveMut.isPending}>
            {t('settings.bankSync.saveButton')}
          </button>
        </form>
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
            {connections.map((conn) => {
              const chip = connectionChipState(conn.status, conn.validUntil, todayIso);
              const result = syncResults[conn.id];
              return (
                <div key={conn.id} className="rounded-lg border border-ink-800/60 p-3 flex flex-col gap-3">
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
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={connectMut.isPending}
                          onClick={() => connectMut.mutate(conn.aspspName)}
                        >
                          {t('settings.bankSync.connections.reconnectButton')}
                        </button>
                      )}
                      {chip !== 'required' && (
                        <button
                          type="button"
                          className="btn-ghost"
                          disabled={syncMut.isPending && syncingId === conn.id}
                          onClick={() => {
                            setSyncingId(conn.id);
                            syncMut.mutate(conn.id);
                          }}
                        >
                          {syncMut.isPending && syncingId === conn.id
                            ? t('settings.bankSync.connections.syncing')
                            : t('settings.bankSync.connections.syncButton')}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => setConfirmDisconnect(conn)}
                      >
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
                          onChange={(e) =>
                            mappingMut.mutate({
                              connectionId: conn.id,
                              bankAccountUid: a.bankAccountUid,
                              accountId: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
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
                    </div>
                  )}
                  {result && result.status !== 'ok' && (
                    <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200">
                      {result.status === 'needs_reconnect'
                        ? t('settings.bankSync.connections.reconnectRequired')
                        : t('settings.bankSync.errors.generic')}
                    </div>
                  )}
                </div>
              );
            })}
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
