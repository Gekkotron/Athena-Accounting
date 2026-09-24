import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import type { TriGroup } from '../../api/types';
import { useCategories, EMPTY_CATEGORIES } from '../../lib/useReferenceData';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useAutoStartTour } from '../../hooks/useAutoStartTour';
import { useTourAnchor } from '../../hooks/useTourAnchor';
import { TourReplayIcon } from '../../components/TourReplayIcon';
import { TriGroupRow } from './TriGroupRow';
import { TriBulkBar } from './TriBulkBar';

export function Tri() {
  const { t } = useTranslation(['rules', 'common']);
  const qc = useQueryClient();
  const groupsQ = useQuery({
    queryKey: ['tri-groups'],
    queryFn: () =>
      api<{
        groups: TriGroup[];
        pagination: { total: number; limit: number; offset: number };
      }>('/api/tri/groups', { query: { limit: 200, offset: 0 } }),
  });
  const categoriesQ = useCategories();

  useAutoStartTour('rules');
  const rulesListAnchor = useTourAnchor('rules:list');
  // HubLayout renders its tab nav next to <Outlet/>, outside this page's own
  // JSX tree (confirmed by grepping HubLayout.tsx), so the "Tri" tab element
  // itself is unreachable from here. Fallback: anchor the tri-tab step to
  // the top of this page's own body — the coach-mark still lands on the
  // Sort page, just anchored to its content rather than its tab.
  const triTabAnchor = useTourAnchor('rules:tri-tab');

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [perGroupCategory, setPerGroupCategory] = useState<Map<string, number>>(new Map());
  const [bulkCategoryId, setBulkCategoryId] = useState<number | ''>('');
  const [createRules, setCreateRules] = useState(true);
  const [confirmRecat, setConfirmRecat] = useState(false);

  const groups = groupsQ.data?.groups ?? [];
  const total = groupsQ.data?.pagination.total ?? groups.length;
  const categories = categoriesQ.data ?? EMPTY_CATEGORIES;
  const byId = useMemo(
    () => new Map(categories.map((c) => [c.id, c] as const)),
    [categories],
  );

  const toggle = (label: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  const selectAll = () => setSelected(new Set(groups.map((g) => g.normalized_label)));
  const clearSel = () => setSelected(new Set());

  const setGroupCat = (label: string, categoryId: number) =>
    setPerGroupCategory((m) => {
      const next = new Map(m);
      next.set(label, categoryId);
      return next;
    });

  const clearGroupCat = (label: string) =>
    setPerGroupCategory((m) => {
      const next = new Map(m);
      next.delete(label);
      return next;
    });

  const assign = useMutation({
    mutationFn: (input: { groups: { normalizedLabel: string; categoryId: number }[]; createRules: boolean }) =>
      api<{ assigned: number; rulesCreated: number }>('/api/tri/assign', { method: 'POST', json: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tri-groups'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['rules'] });
      setSelected(new Set());
      setPerGroupCategory(new Map());
    },
  });

  const recategorize = useMutation({
    mutationFn: () =>
      api<{ total: number; recategorized: number; unknown: number; preserved: number }>(
        '/api/recategorize',
        { method: 'POST', json: { preserveManual: true } },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tri-groups'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
    },
  });

  const assignSingle = (label: string) => {
    const categoryId = perGroupCategory.get(label);
    if (!categoryId) return;
    assign.mutate({ groups: [{ normalizedLabel: label, categoryId }], createRules });
  };

  const assignBulk = () => {
    if (!bulkCategoryId || selected.size === 0) return;
    const groupsToAssign = Array.from(selected).map((normalizedLabel) => ({
      normalizedLabel,
      categoryId: bulkCategoryId as number,
    }));
    assign.mutate({ groups: groupsToAssign, createRules });
  };

  const processed = groups.filter(
    (g) => perGroupCategory.has(g.normalized_label) || selected.has(g.normalized_label),
  ).length;

  return (
    <div ref={triTabAnchor} className="flex flex-col gap-6">
      <div className="page-header">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="page-title">{t('tri.title')}</h1>
            <TourReplayIcon pageId="rules" />
          </div>
          <p className="page-subtitle">
            <span className="font-mono">{processed} / {total}</span>{' '}
            {t('tri.subtitle.groups', { count: total })}{' '}
            {t('tri.subtitle.processed', { count: processed })} · {t('tri.subtitle.sortedByFrequency')}
          </p>
        </div>
        <button
          className="btn-secondary"
          onClick={() => setConfirmRecat(true)}
          disabled={recategorize.isPending}
        >
          {recategorize.isPending ? t('recategorize.pending') : t('recategorize.button')}
        </button>
      </div>

      <ConfirmDialog
        open={confirmRecat}
        title={t('recategorize.dialog.title')}
        description={
          <Trans i18nKey="rules:recategorize.dialog.description">
            All enabled rules are re-applied to every transaction (excluding internal transfers). Your <span className="display-italic">manual choices</span> are preserved — only
            transactions with source "auto" or "default" are re-evaluated.
          </Trans>
        }
        confirmLabel={t('recategorize.dialog.confirmLabel')}
        busy={recategorize.isPending}
        onConfirm={() =>
          recategorize.mutate(undefined, { onSuccess: () => setConfirmRecat(false) })
        }
        onCancel={() => setConfirmRecat(false)}
      />

      {recategorize.data && (
        <div className="surface p-4 text-sm text-sage-200">
          {t('recategorize.summary.total')} <span className="font-mono">{recategorize.data.total}</span> ·{' '}
          {t('recategorize.summary.recategorized')}{' '}
          <span className="font-mono text-sage-300">{recategorize.data.recategorized}</span> ·{' '}
          {t('recategorize.summary.unknown')} <span className="font-mono">{recategorize.data.unknown}</span> ·{' '}
          {t('recategorize.summary.preserved')} <span className="font-mono">{recategorize.data.preserved}</span>
        </div>
      )}

      <TriBulkBar
        categories={categories}
        byId={byId}
        bulkCategoryId={bulkCategoryId}
        setBulkCategoryId={setBulkCategoryId}
        createRules={createRules}
        setCreateRules={setCreateRules}
        selectedCount={selected.size}
        totalGroups={groups.length}
        assignPending={assign.isPending}
        onAssignBulk={assignBulk}
        onSelectAll={selectAll}
        onClearSelection={clearSel}
      />

      <div ref={rulesListAnchor} className="surface overflow-hidden">
        <div className="table-scroll">
          <table className="w-full text-sm stack-md">
            <thead className="text-left">
              <tr className="border-b border-ink-800/70">
                <th className="px-4 py-3 w-8"></th>
                <th className="px-4 py-3 label font-normal">{t('tri.columns.normalizedLabel')}</th>
                <th className="px-4 py-3 label font-normal hidden lg:table-cell">{t('tri.columns.example')}</th>
                <th className="px-4 py-3 label font-normal text-right hidden sm:table-cell">{t('tri.columns.count')}</th>
                <th className="px-4 py-3 label font-normal text-right">{t('tri.columns.total')}</th>
                <th className="px-4 py-3 label font-normal hidden md:table-cell">{t('tri.columns.period')}</th>
                <th className="px-4 py-3 label font-normal">{t('tri.columns.category')}</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-ink-500">
                    <span className="display-italic">
                      {groupsQ.isLoading ? t('loading', { ns: 'common' }) : t('tri.emptyState')}
                    </span>
                  </td>
                </tr>
              ) : (
                groups.map((g) => (
                  <TriGroupRow
                    key={g.normalized_label}
                    g={g}
                    selected={selected.has(g.normalized_label)}
                    localCategoryId={perGroupCategory.get(g.normalized_label)}
                    categories={categories}
                    byId={byId}
                    onToggleSelect={() => toggle(g.normalized_label)}
                    onSetGroupCategory={(id) => setGroupCat(g.normalized_label, id)}
                    onClearGroupCategory={() => clearGroupCat(g.normalized_label)}
                    onAssignRow={() => assignSingle(g.normalized_label)}
                    assignPending={assign.isPending}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
