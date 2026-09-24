import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api/client';
import {
  extractAuthCode,
  type BankConnection,
  type SyncConnectionResult,
} from './SettingsBankSync-lib';

// Consolidates every mutation + local-state slot on the bank-sync tab.
// The parent stays free to focus on layout + queries + confirm dialogs.
export function useBankSyncActions() {
  const qc = useQueryClient();
  const { t } = useTranslation('settings');

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

  return {
    saveOk, setSaveOk,
    confirmDelete, setConfirmDelete, deleteMut,
    selectedBank, setSelectedBank, connectError, setConnectError, connectMut,
    manualInput, setManualInput, manualError, manualOk, manualMut, submitManual,
    syncResults, syncingId, setSyncingId, syncMut,
    mappingMut,
    confirmDisconnect, setConfirmDisconnect, disconnectMut,
  };
}
