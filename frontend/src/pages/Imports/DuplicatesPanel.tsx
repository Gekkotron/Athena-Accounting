import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { groupMinPairwiseSimilarity } from '../../lib/label-similarity';
import { useSettings } from '../../lib/useSettings';
import { DemoUnavailableState, ErrorState, LoadingBlock } from '../../components/StateBlocks';
import { isDemoStubError } from '../../api/errorMessage';
import { useDuplicatesMutations } from './useDuplicatesMutations';
import { useAccounts } from '../../lib/useReferenceData';
import { DuplicateGroupRow } from './DuplicateGroupRow';
import { DuplicatesBulkBar } from './DuplicatesBulkBar';

export function DuplicatesPanel(): JSX.Element {
  const { t } = useTranslation(['imports', 'common', 'transactions']);

  const accountsQ = useAccounts();
  const accounts = accountsQ.data ?? [];

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

  // Delete a single transaction directly from the doublons panel. Confirms inline
  // before firing to avoid an accidental click on the trash icon.
  const [confirmDeleteTxId, setConfirmDeleteTxId] = useState<number | null>(null);
  const [dupDeleteError, setDupDeleteError] = useState<string | null>(null);
  // Bulk selection across groups. Distinct from the per-group "Pas un doublon"
  // button (which acts on every row of a group) — the user picks specific rows
  // spanning groups and applies one action to all of them.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkError, setBulkError] = useState<string | null>(null);

  const { markNotDuplicateMut, deleteTxMut, bulkDeleteMut, bulkMarkNotDupMut } =
    useDuplicatesMutations({
      setConfirmDeleteTxId,
      setDupDeleteError,
      setSelectedIds,
      setBulkError,
    });

  const toggleSelect = useCallback((id: number, checked: boolean) =>
    setSelectedIds((s) => {
      const next = new Set(s);
      if (checked) next.add(id); else next.delete(id);
      return next;
    }), []);

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
    const demo = isDemoStubError(dupsQ.error);
    return (
      <section>
        <div className="flex items-center justify-between mb-4">
          <div className="section-rule flex-1">{t('duplicates.sectionTitle')}</div>
          {!demo && refreshButton}
        </div>
        {demo ? (
          <DemoUnavailableState
            hint="La détection de doublons croise les transactions côté base de données. Installez Athena localement pour l'utiliser."
          />
        ) : (
          <ErrorState
            title={t('duplicates.errorTitle')}
            error={dupsQ.error}
            onRetry={() => void dupsQ.refetch()}
          />
        )}
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
          <DuplicatesBulkBar
            selectedIds={selectedIds}
            onClear={() => { setSelectedIds(new Set()); setBulkError(null); }}
            bulkMarkNotDupMut={bulkMarkNotDupMut}
            bulkDeleteMut={bulkDeleteMut}
          />
        )}
        {bulkError && (
          <div className="mb-3 rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200">
            {bulkError}
          </div>
        )}
        <div className="table-scroll">
          <table className="w-full text-sm stack-md">
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
                <DuplicateGroupRow
                  key={`${g.accountId}-${g.date}-${g.amount}-${gi}`}
                  group={g}
                  similarity={similarity}
                  accounts={accounts}
                  selectedIds={selectedIds}
                  onToggleSelect={toggleSelect}
                  confirmDeleteTxId={confirmDeleteTxId}
                  setConfirmDeleteTxId={setConfirmDeleteTxId}
                  dupDeleteError={dupDeleteError}
                  setDupDeleteError={setDupDeleteError}
                  deleteTxMut={deleteTxMut}
                  markNotDuplicateMut={markNotDuplicateMut}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
