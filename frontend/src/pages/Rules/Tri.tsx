import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import type { Category, TriGroup } from '../../api/types';
import { formatAmount, formatDate, amountSignClass } from '../../lib/format';
import { formatCategoryPath } from '../../lib/categories';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { SectionTip } from '../../components/SectionTip';
import { SectionTipHelpIcon } from '../../components/SectionTipHelpIcon';

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
  const categoriesQ = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<{ categories: Category[] }>('/api/categories'),
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [perGroupCategory, setPerGroupCategory] = useState<Map<string, number>>(new Map());
  const [bulkCategoryId, setBulkCategoryId] = useState<number | ''>('');
  const [createRules, setCreateRules] = useState(true);
  const [confirmRecat, setConfirmRecat] = useState(false);

  const groups = groupsQ.data?.groups ?? [];
  const total = groupsQ.data?.pagination.total ?? groups.length;
  const categories = categoriesQ.data?.categories ?? [];
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
    <div className="flex flex-col gap-6">
      <SectionTip id="section:rules" />
      <div className="page-header">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="page-title">{t('tri.title')}</h1>
            <SectionTipHelpIcon id="section:rules" />
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

      <div className="surface p-4 md:p-5 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="label mb-1.5 block">{t('tri.bulk.categoryLabel')}</label>
          <select
            className="input"
            value={bulkCategoryId}
            onChange={(e) => setBulkCategoryId(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">—</option>
            {[...categories]
              .sort((a, b) => {
                const pa = a.parentId != null ? byId.get(a.parentId)?.name ?? '' : a.name;
                const pb = b.parentId != null ? byId.get(b.parentId)?.name ?? '' : b.name;
                return pa.localeCompare(pb) || a.name.localeCompare(b.name);
              })
              .map((c) => (
                <option key={c.id} value={c.id}>{formatCategoryPath(c, byId)}</option>
              ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-300 cursor-pointer">
          <input
            type="checkbox"
            checked={createRules}
            onChange={(e) => setCreateRules(e.target.checked)}
            className="h-4 w-4 rounded border-ink-700 bg-ink-900 accent-sage-300"
          />
          {t('tri.actions.createRule')}
        </label>
        <button
          className="btn-primary"
          onClick={assignBulk}
          disabled={!bulkCategoryId || selected.size === 0 || assign.isPending}
        >
          {t('tri.actions.applyToSelection')} <span className="font-mono">{selected.size}</span>{' '}
          {t('tri.actions.groupSuffix', { count: selected.size })}
        </button>
        <div className="flex gap-2 w-full sm:w-auto sm:ml-auto">
          <button className="btn-ghost" onClick={selectAll} disabled={groups.length === 0}>
            {t('tri.actions.selectAll')}
          </button>
          <button className="btn-ghost" onClick={clearSel} disabled={selected.size === 0}>
            {t('tri.actions.clearSelection')}
          </button>
        </div>
      </div>

      <div className="surface overflow-hidden">
        <div className="table-scroll">
          <table className="w-full text-sm">
            <thead className="text-left">
              <tr className="border-b border-ink-800/70">
                <th className="px-4 py-3 w-8"></th>
                <th className="px-4 py-3 label font-normal">{t('tri.columns.normalizedLabel')}</th>
                <th className="px-4 py-3 label font-normal hidden lg:table-cell">{t('tri.columns.example')}</th>
                <th className="px-4 py-3 label font-normal text-right">{t('tri.columns.count')}</th>
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
                groups.map((g) => {
                  const selectedG = selected.has(g.normalized_label);
                  const localCat = perGroupCategory.get(g.normalized_label);
                  return (
                    <tr
                      key={g.normalized_label}
                      className={`border-b border-ink-800/40 last:border-0 transition ${
                        selectedG ? 'bg-sage-900/15' : 'hover:bg-ink-850/40'
                      }`}
                    >
                      <td className="px-4 py-2.5">
                        <input
                          type="checkbox"
                          checked={selectedG}
                          onChange={() => toggle(g.normalized_label)}
                          className="h-4 w-4 rounded border-ink-700 bg-ink-900 accent-sage-300"
                        />
                      </td>
                      <td className="px-4 py-2.5 text-ink-100 font-mono text-xs max-w-[200px] truncate">{g.normalized_label}</td>
                      <td className="px-4 py-2.5 text-ink-400 text-xs truncate max-w-xs hidden lg:table-cell" title={g.example_raw_label}>
                        {g.example_raw_label}
                      </td>
                      <td className="px-4 py-2.5 text-right text-ink-200 font-mono">{g.transaction_count}</td>
                      <td className={`px-4 py-2.5 text-right font-mono tabular-nums ${amountSignClass(g.total_amount)}`}>
                        {formatAmount(g.total_amount, 'EUR')}
                      </td>
                      <td className="px-4 py-2.5 text-ink-500 text-[11px] font-mono whitespace-nowrap hidden md:table-cell">
                        {formatDate(g.min_date)} → {formatDate(g.max_date)}
                      </td>
                      <td className="px-4 py-2.5">
                        <select
                          className="input-sm"
                          value={localCat ?? ''}
                          onChange={(e) =>
                            e.target.value
                              ? setGroupCat(g.normalized_label, Number(e.target.value))
                              : setPerGroupCategory((m) => {
                                  const next = new Map(m);
                                  next.delete(g.normalized_label);
                                  return next;
                                })
                          }
                        >
                          <option value="">—</option>
                          {[...categories]
                            .sort((a, b) => {
                              const pa = a.parentId != null ? byId.get(a.parentId)?.name ?? '' : a.name;
                              const pb = b.parentId != null ? byId.get(b.parentId)?.name ?? '' : b.name;
                              return pa.localeCompare(pb) || a.name.localeCompare(b.name);
                            })
                            .map((c) => (
                              <option key={c.id} value={c.id}>{formatCategoryPath(c, byId)}</option>
                            ))}
                        </select>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          className="text-xs text-sage-300 hover:text-sage-200 disabled:opacity-40 disabled:hover:text-sage-300 transition"
                          disabled={!localCat || assign.isPending}
                          onClick={() => assignSingle(g.normalized_label)}
                        >
                          {t('tri.actions.applyRow')}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
