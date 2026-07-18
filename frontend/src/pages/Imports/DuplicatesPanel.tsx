import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { Account } from '../../api/types';
import { getAccountName } from '../../lib/accounts';
import { groupMinPairwiseSimilarity } from '../../lib/label-similarity';
import { useSettings } from '../../lib/useSettings';
import { ErrorState, LoadingBlock } from '../../components/StateBlocks';

export function DuplicatesPanel(): JSX.Element {
  const { t } = useTranslation(['imports', 'common', 'transactions']);
  const qc = useQueryClient();

  const accountsQ = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api<{ accounts: Account[] }>('/api/accounts'),
  });
  const accounts = accountsQ.data?.accounts ?? [];

  // Soft-dup detection: groups of transactions sharing (account, date, amount)
  // but with different dedup_keys. Surfaces after each import so the user can
  // resolve labels-that-look-the-same-but-aren't (the OFX/PDF gap).
  type DupGroup = {
    accountId: number;
    date: string;
    amount: string;
    transactions: Array<{ id: number; raw_label: string; normalized_label: string; source_file_id: number | null; category_id: number | null }>;
  };
  const dupsQ = useQuery({
    queryKey: ['transaction-duplicates'],
    queryFn: () => api<{ groups: DupGroup[] }>('/api/transactions/duplicates'),
    // Refetch on tab focus so the panel picks up new clusters after the
    // user imports elsewhere or comes back from another tab.
    refetchOnWindowFocus: true,
  });

  // Mark every row in a doublons group as "not a duplicate". The group then
  // disappears from the panel because BOOL_OR(NOT not_duplicate) goes false.
  // If a NEW row with the same (account, date, amount) shows up later, the
  // group re-appears so the user can re-evaluate.
  const markNotDuplicateMut = useMutation({
    mutationFn: (ids: number[]) =>
      api<{ updated: number }>('/api/transactions/mark-not-duplicate', {
        method: 'POST',
        json: { ids },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transaction-duplicates'] });
    },
  });

  // Delete a single transaction directly from the doublons panel. Confirms inline
  // before firing to avoid an accidental click on the trash icon.
  const [confirmDeleteTxId, setConfirmDeleteTxId] = useState<number | null>(null);
  const [dupDeleteError, setDupDeleteError] = useState<string | null>(null);
  const deleteTxMut = useMutation({
    mutationFn: (id: number) =>
      api<{ ok: true }>(`/api/transactions/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transaction-duplicates'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      qc.invalidateQueries({ queryKey: ['tri-groups'] });
      setConfirmDeleteTxId(null);
      setDupDeleteError(null);
    },
    onError: (err: ApiError) => setDupDeleteError(err.message),
  });

  // Bulk selection across groups. Distinct from the per-group "Pas un doublon"
  // button (which acts on every row of a group) — the user picks specific rows
  // spanning groups and applies one action to all of them.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkError, setBulkError] = useState<string | null>(null);

  const bulkDeleteMut = useMutation({
    mutationFn: (ids: number[]) =>
      api<{ deleted: number }>('/api/transactions/delete-bulk', {
        method: 'POST',
        json: { ids },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transaction-duplicates'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      qc.invalidateQueries({ queryKey: ['tri-groups'] });
      setSelectedIds(new Set());
      setBulkError(null);
    },
    onError: (err: ApiError) => setBulkError(err.message),
  });

  const bulkMarkNotDupMut = useMutation({
    mutationFn: (ids: number[]) =>
      api<{ updated: number }>('/api/transactions/mark-not-duplicate', {
        method: 'POST',
        json: { ids },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transaction-duplicates'] });
      setSelectedIds(new Set());
      setBulkError(null);
    },
    onError: (err: ApiError) => setBulkError(err.message),
  });

  const toggleSelect = (id: number, checked: boolean) =>
    setSelectedIds((s) => {
      const next = new Set(s);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  // Label-similarity threshold (0..100), seeded from user settings on mount;
  // in-session changes are ephemeral (no writeback — edit Réglages to make a
  // change stick). At 0, the panel behaves as before (no filtering).
  const { settings, isReady } = useSettings();
  const [threshold, setThreshold] = useState<number>(settings.duplicateSimilarityThreshold);
  // If settings arrive after the initial render (first paint used DEFAULTS),
  // hydrate the local state once — gated on isReady so we don't latch onto
  // the DEFAULTS fallback while the settings query is still loading.
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current || !isReady) return;
    hydrated.current = true;
    setThreshold(settings.duplicateSimilarityThreshold);
  }, [isReady, settings.duplicateSimilarityThreshold]);

  const rawGroups = dupsQ.data?.groups ?? [];

  // Annotate each group with its min-pairwise similarity so we can (a)
  // filter below the threshold and (b) display the score alongside.
  const scoredGroups = useMemo(
    () =>
      rawGroups.map((g) => ({
        group: g,
        similarity: groupMinPairwiseSimilarity(g.transactions.map((tx) => tx.raw_label)),
      })),
    [rawGroups],
  );
  const visibleGroups = scoredGroups.filter(
    ({ similarity }) => similarity * 100 >= threshold,
  );
  const hiddenCount = scoredGroups.length - visibleGroups.length;

  const refreshButton = (
    <button
      type="button"
      onClick={() => dupsQ.refetch()}
      disabled={dupsQ.isFetching}
      title={t('duplicates.refresh.title')}
      aria-label={t('duplicates.refresh.ariaLabel')}
      className="text-[11px] text-ink-400 hover:text-ink-100 border border-ink-800 hover:border-ink-700 rounded-md px-2 py-1 transition disabled:opacity-40"
    >
      {dupsQ.isFetching ? t('duplicates.refresh.loading') : t('duplicates.refresh.idle')}
    </button>
  );

  if (dupsQ.isError) {
    return (
      <section>
        <div className="flex items-center justify-between mb-4">
          <div className="section-rule flex-1">{t('duplicates.sectionTitle')}</div>
          {refreshButton}
        </div>
        <ErrorState
          title={t('duplicates.errorTitle')}
          error={dupsQ.error}
          onRetry={() => void dupsQ.refetch()}
        />
      </section>
    );
  }

  if (dupsQ.isLoading) {
    return (
      <section>
        <div className="flex items-center justify-between mb-4">
          <div className="section-rule flex-1">{t('duplicates.sectionTitle')}</div>
          {refreshButton}
        </div>
        <LoadingBlock height="min-h-32" />
      </section>
    );
  }

  if (scoredGroups.length === 0) {
    return (
      <section>
        <div className="flex items-center justify-between mb-4">
          <div className="section-rule flex-1">{t('duplicates.sectionTitle')}</div>
          {refreshButton}
        </div>
        <div className="surface p-5 text-sm text-ink-500 display-italic">
          {t('duplicates.emptyState')}
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div className="section-rule flex-1">{t('duplicates.sectionTitle')}</div>
        {refreshButton}
      </div>
      <div className="surface p-5">
        <p className="text-sm text-ink-300 mb-3">
          {t('duplicates.description.prefix')}{' '}
          <span className="display-italic">{t('title', { ns: 'transactions' })}</span>
          {t('duplicates.description.suffix')}
        </p>
        <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-ink-400">
          <label className="flex items-center gap-2">
            <span>{t('duplicates.thresholdLabel')}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="accent-sage-300 w-40"
              aria-label={t('duplicates.thresholdAriaLabel')}
            />
            <span className="font-mono text-ink-200 w-10">{threshold}%</span>
          </label>
          {hiddenCount > 0 && (
            <span className="text-ink-500 font-mono">
              {t('duplicates.hiddenGroups', { count: hiddenCount })}
            </span>
          )}
        </div>
        {selectedIds.size > 0 && (
          <div className="mb-3 rounded-lg border border-sage-800/40 bg-sage-900/15 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-ink-100">
              <span className="font-mono">{selectedIds.size}</span> {t('duplicates.selectedCount', { count: selectedIds.size })}
            </span>
            <div className="flex items-center gap-2">
              <button
                className="text-[11px] text-ink-500 hover:text-ink-100 transition"
                onClick={() => { setSelectedIds(new Set()); setBulkError(null); }}
              >
                {t('duplicates.clearSelection')}
              </button>
              <button
                className="text-xs text-sage-300 hover:text-sage-200 border border-sage-300/40 hover:border-sage-300 rounded-md px-2 py-1 transition disabled:opacity-40"
                disabled={bulkMarkNotDupMut.isPending || bulkDeleteMut.isPending}
                onClick={() => bulkMarkNotDupMut.mutate(Array.from(selectedIds))}
              >
                {t('duplicates.markNotDuplicate')}
              </button>
              <button
                className="text-xs text-clay-300 hover:text-clay-200 border border-clay-800/60 hover:border-clay-700 rounded-md px-2 py-1 transition disabled:opacity-40"
                disabled={bulkDeleteMut.isPending || bulkMarkNotDupMut.isPending}
                onClick={() => bulkDeleteMut.mutate(Array.from(selectedIds))}
              >
                {t('delete', { ns: 'common' })}
              </button>
            </div>
          </div>
        )}
        {bulkError && (
          <div className="mb-3 rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200">
            {bulkError}
          </div>
        )}
        <div className="table-scroll">
          <table className="w-full text-sm">
            <thead className="text-left">
              <tr className="border-b border-ink-800/70">
                <th className="px-4 py-3 label font-normal">{t('duplicates.table.account')}</th>
                <th className="px-4 py-3 label font-normal">{t('duplicates.table.date')}</th>
                <th className="px-4 py-3 label font-normal text-right">{t('duplicates.table.amount')}</th>
                <th className="px-4 py-3 label font-normal">{t('duplicates.table.conflictingLabels')}</th>
                <th className="px-4 py-3 label font-normal text-right w-20">{t('duplicates.table.similarity')}</th>
                <th className="px-4 py-3 label font-normal text-right w-44">{t('duplicates.table.action')}</th>
              </tr>
            </thead>
            <tbody>
              {visibleGroups.map(({ group: g, similarity }, gi) => (
                <tr key={`${g.accountId}-${g.date}-${g.amount}-${gi}`} className="border-b border-ink-800/40 last:border-0 align-top">
                  <td className="px-4 py-2.5 text-ink-300">{getAccountName(accounts, g.accountId)}</td>
                  <td className="px-4 py-2.5 text-ink-300 font-mono text-xs whitespace-nowrap">{g.date}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-ink-100">
                    {Number(g.amount).toFixed(2).replace('.', ',')} €
                  </td>
                  <td className="px-4 py-2.5">
                    <ul className="space-y-1">
                      {g.transactions.map((tx) => {
                        const confirming = confirmDeleteTxId === tx.id;
                        return (
                          <li key={tx.id} className="flex items-baseline gap-2">
                            <input
                              type="checkbox"
                              className="accent-sage-300"
                              checked={selectedIds.has(tx.id)}
                              onChange={(e) => toggleSelect(tx.id, e.target.checked)}
                              aria-label={t('duplicates.selectTransactionAriaLabel', { id: tx.id })}
                            />
                            <code className="text-xs text-ink-500 min-w-[3.5rem]">#{tx.id}</code>
                            <span className="font-mono text-xs text-ink-100 flex-1">{tx.raw_label}</span>
                            {confirming ? (
                              <span className="flex items-center gap-1">
                                <button
                                  className="px-2 py-0.5 rounded-md bg-clay-300 text-ink-950 text-xs font-medium hover:bg-clay-200 transition disabled:opacity-40"
                                  disabled={deleteTxMut.isPending}
                                  onClick={() => deleteTxMut.mutate(tx.id)}
                                >{deleteTxMut.isPending ? '…' : t('delete', { ns: 'common' })}</button>
                                <button
                                  className="px-2 py-0.5 rounded-md border border-ink-700 text-ink-200 text-xs hover:bg-ink-850 transition"
                                  onClick={() => { setConfirmDeleteTxId(null); setDupDeleteError(null); }}
                                >{t('cancel', { ns: 'common' })}</button>
                              </span>
                            ) : (
                              <button
                                className="text-ink-500 hover:text-clay-300 transition px-1"
                                onClick={() => { setConfirmDeleteTxId(tx.id); setDupDeleteError(null); }}
                                title={t('duplicates.deleteTransactionTitle', { id: tx.id })}
                                aria-label={t('duplicates.deleteTransactionAriaLabel')}
                              >🗑</button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    {dupDeleteError && confirmDeleteTxId !== null &&
                      g.transactions.some((tx) => tx.id === confirmDeleteTxId) && (
                        <p className="mt-2 text-xs text-clay-300">{dupDeleteError}</p>
                      )}
                  </td>
                  <td className="px-4 py-2.5 text-right align-top font-mono text-xs text-ink-400" title={t('duplicates.similarityTitle')}>
                    {Math.round(similarity * 100)}%
                  </td>
                  <td className="px-4 py-2.5 text-right align-top">
                    <button
                      className="text-xs text-sage-300 hover:text-sage-200 border border-sage-300/40 hover:border-sage-300 rounded-md px-2 py-1 transition disabled:opacity-40"
                      disabled={markNotDuplicateMut.isPending}
                      onClick={() => markNotDuplicateMut.mutate(g.transactions.map((tx) => tx.id))}
                      title={t('duplicates.markNotDuplicateTitle')}
                    >
                      {t('duplicates.markNotDuplicate')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
