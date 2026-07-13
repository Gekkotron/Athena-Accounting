import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { Account, BudgetPeriod, Category } from '../../api/types';
import { useBudgets, useBudgetReport } from '../../lib/useBudgets';
import { formatCategoryPath, groupCategories } from '../../lib/categories';
import { PeriodSelector } from './PeriodSelector';
import { AccountFilter } from './AccountFilter';
import { SummaryCard } from './SummaryCard';
import { BudgetRow } from './BudgetRow';
import { SuggestionCard } from './SuggestionCard';
import { UnbudgetedSection } from './UnbudgetedSection';
import { topLevelRows } from './budget-math';

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function currentYear(): string {
  return String(new Date().getFullYear());
}

function isValidLimit(v: string): boolean {
  return /^\d+(\.\d{1,2})?$/.test(v) && Number(v) > 0;
}

const MUTATION_ERROR_FALLBACK = "Impossible d'enregistrer le budget.";

function mutationErrorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : MUTATION_ERROR_FALLBACK;
}

export function Budgets(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const period = (params.get('period') ?? 'monthly') as BudgetPeriod;
  const monthOrYear = params.get(period === 'monthly' ? 'month' : 'year')
    ?? (period === 'monthly' ? currentMonth() : currentYear());
  const accountIdParam = params.get('account');
  const accountId = accountIdParam ? Number(accountIdParam) : null;

  const setPeriodState = (v: { period: BudgetPeriod; monthOrYear: string }) => {
    const next = new URLSearchParams(params);
    next.set('period', v.period);
    if (v.period === 'monthly') { next.set('month', v.monthOrYear); next.delete('year'); }
    else { next.set('year', v.monthOrYear); next.delete('month'); }
    setParams(next, { replace: true });
  };

  const setAccountFilter = (id: number | null) => {
    const next = new URLSearchParams(params);
    if (id == null) next.delete('account'); else next.set('account', String(id));
    setParams(next, { replace: true });
  };

  const { budgets, create, update, remove } = useBudgets();
  const report = useBudgetReport({
    period,
    month: period === 'monthly' ? monthOrYear : undefined,
    year: period === 'yearly' ? monthOrYear : undefined,
    accountId,
  });
  const rows = report.data?.rows ?? [];

  const accountsQ = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api<{ accounts: Account[] }>('/api/accounts'),
  });
  const accounts = accountsQ.data?.accounts ?? [];

  const categoriesQ = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<{ categories: Category[] }>('/api/categories'),
  });
  const cats = categoriesQ.data?.categories ?? [];
  const { roots, childrenByParent } = useMemo(() => groupCategories(cats), [cats]);
  const rowsByCategory = useMemo(
    () => new Map(rows.map((r) => [r.categoryId, r] as const)),
    [rows],
  );
  const visibleRoots = useMemo(
    () => roots.filter((r) => {
      if (rowsByCategory.has(r.id)) return true;
      const children = childrenByParent.get(r.id) ?? [];
      return children.some((c) => rowsByCategory.has(c.id));
    }),
    [roots, childrenByParent, rowsByCategory],
  );
  const budgetedIds = useMemo(() => new Set(budgets.map((b) => b.categoryId)), [budgets]);
  const allCategories = cats;
  const byId = useMemo(
    () => new Map(allCategories.map((c) => [c.id, c] as const)),
    [allCategories],
  );
  const addable = allCategories.filter(
    (c) => c.kind === 'expense' && !budgetedIds.has(c.id),
  );

  // The server totals a naive sum across every budgeted row (see
  // reports.ts) — when a parent AND its child both carry a budget, the
  // child's spend is already rolled into the parent's own `spent` value,
  // so summing both rows double-counts it. Filter to rollup-aware rows
  // once here, then derive both the summary totals AND the SummaryCard's
  // chart data from the same filtered set — otherwise the chart re-sums
  // the raw rows and reintroduces the double-count the totals fix removed.
  const filteredRows = useMemo(() => topLevelRows(rows, allCategories), [rows, allCategories]);

  const summaryTotals = useMemo(() => {
    const limit = filteredRows.reduce((a, r) => a + Number(r.limit), 0);
    const spent = filteredRows.reduce((a, r) => a + Number(r.spent), 0);
    const allProjected = filteredRows.length > 0 && filteredRows.every((r) => r.projected != null);
    const projected = allProjected
      ? filteredRows.reduce((a, r) => a + Number(r.projected), 0).toFixed(2)
      : null;
    return {
      limit: limit.toFixed(2),
      spent: spent.toFixed(2),
      remaining: (limit - spent).toFixed(2),
      projected,
    };
  }, [filteredRows]);

  const [newCatId, setNewCatId] = useState('');
  const [newLimit, setNewLimit] = useState('');
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<{ categoryId: number; suggested: string } | null>(null);

  useEffect(() => {
    if (prefill) {
      setNewCatId(String(prefill.categoryId));
      setNewLimit(prefill.suggested);
    }
  }, [prefill]);

  const submitNew = () => {
    const categoryId = Number(newCatId);
    if (!categoryId || !isValidLimit(newLimit)) return;
    setMutationError(null);
    create.mutate({ categoryId, monthlyLimit: newLimit }, {
      onSuccess: () => { setNewCatId(''); setNewLimit(''); setMutationError(null); },
      onError: (err) => setMutationError(mutationErrorMessage(err)),
    });
  };

  const handleSave = (id: number, limit: string) => update.mutate({ id, monthlyLimit: limit }, {
    onSuccess: () => setMutationError(null),
    onError: (err) => setMutationError(mutationErrorMessage(err)),
  });
  const handleDelete = (id: number) => remove.mutate(id, {
    onSuccess: () => setMutationError(null),
    onError: (err) => setMutationError(mutationErrorMessage(err)),
  });

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="display text-2xl text-ink-50">Budgets</h1>
          <p className="text-sm text-ink-400 mt-1">
            Plafond par catégorie de dépense.
          </p>
        </div>
        <PeriodSelector period={period} monthOrYear={monthOrYear} onChange={setPeriodState} />
      </div>

      {mutationError && (
        <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200">
          {mutationError}
        </div>
      )}

      {report.data && report.data.rows.length > 0 && (
        <SummaryCard
          totals={summaryTotals}
          rows={filteredRows}
          period={report.data.period}
          monthOrYear={monthOrYear}
        />
      )}

      {accounts.length > 1 && (
        <AccountFilter accountId={accountId} accounts={accounts} onChange={setAccountFilter} />
      )}

      {/* Row list + Suggestions + Unbudgeted + Add form — placeholders for
          Tasks 8–11. For this task, keep the existing per-row rendering,
          sourced from the new `report.data.rows` shape (a strict superset
          of the old one).                                                */}

      {rows.length === 0 ? (
        <div className="surface p-8 text-center text-ink-400">
          <p className="mb-1">Aucun budget défini.</p>
          <p className="text-sm text-ink-500">Ajoutez un plafond à une catégorie de dépense ci-dessous.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {visibleRoots.flatMap((r) => {
            const rootRow = rowsByCategory.get(r.id);
            const nodes: JSX.Element[] = [];
            if (rootRow) {
              const budgetId = budgets.find((b) => b.categoryId === r.id)?.id;
              nodes.push(
                <BudgetRow
                  key={`root-${r.id}`}
                  row={rootRow}
                  depth={0}
                  budgetId={budgetId}
                  onSave={handleSave}
                  onDelete={handleDelete}
                />,
              );
              if (rootRow.suggestedLimit != null && budgetId !== undefined) {
                nodes.push(
                  <SuggestionCard
                    key={`suggest-${r.id}`}
                    row={rootRow}
                    budgetId={budgetId}
                    periodKey={monthOrYear}
                    onApply={(id, newLimit) => update.mutate({ id, monthlyLimit: newLimit })}
                  />,
                );
              }
            } else {
              // Parent has no budget of its own but has budgeted children — slim header.
              nodes.push(
                <li key={`header-${r.id}`} data-role="budget-row" data-depth={0} className="px-4 py-2 text-sm text-ink-500">
                  {r.name}
                </li>,
              );
            }
            for (const c of childrenByParent.get(r.id) ?? []) {
              const row = rowsByCategory.get(c.id);
              if (!row) continue;
              const budgetId = budgets.find((b) => b.categoryId === c.id)?.id;
              nodes.push(
                <BudgetRow
                  key={`child-${c.id}`}
                  row={row}
                  depth={1}
                  budgetId={budgetId}
                  onSave={handleSave}
                  onDelete={handleDelete}
                />,
              );
              if (row.suggestedLimit != null && budgetId !== undefined) {
                nodes.push(
                  <SuggestionCard
                    key={`suggest-${c.id}`}
                    row={row}
                    budgetId={budgetId}
                    periodKey={monthOrYear}
                    onApply={(id, newLimit) => update.mutate({ id, monthlyLimit: newLimit })}
                  />,
                );
              }
            }
            return nodes;
          })}
          {/* Also render any budgeted category whose parent isn't visible (orphaned leaf edge case). */}
          {rows
            .filter((r) => !visibleRoots.some((vr) => vr.id === r.categoryId || (childrenByParent.get(vr.id) ?? []).some((c) => c.id === r.categoryId)))
            .flatMap((r) => {
              const budgetId = budgets.find((b) => b.categoryId === r.categoryId)?.id;
              const nodes = [
                <BudgetRow
                  key={`orphan-${r.categoryId}`}
                  row={r}
                  depth={0}
                  budgetId={budgetId}
                  onSave={handleSave}
                  onDelete={handleDelete}
                />,
              ];
              if (r.suggestedLimit != null && budgetId !== undefined) {
                nodes.push(
                  <SuggestionCard
                    key={`suggest-orphan-${r.categoryId}`}
                    row={r}
                    budgetId={budgetId}
                    periodKey={monthOrYear}
                    onApply={(id, newLimit) => update.mutate({ id, monthlyLimit: newLimit })}
                  />,
                );
              }
              return nodes;
            })}
        </ul>
      )}

      {report.data && (
        <UnbudgetedSection
          candidates={report.data.unbudgetedCandidates}
          period={period}
          onDefineBudget={(categoryId, suggested) => {
            setPrefill({ categoryId, suggested });
            document.getElementById('budgets-add-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }}
        />
      )}

      <div id="budgets-add-form" className="surface p-4 flex flex-col gap-3">
        <div className="label">Ajouter un budget</div>
        {addable.length === 0 ? (
          <p className="text-sm text-ink-500">Toutes vos catégories de dépense ont déjà un plafond.</p>
        ) : (
          <div className="flex items-end gap-2 flex-wrap">
            <select className="input" aria-label="Catégorie" value={newCatId} onChange={(e) => setNewCatId(e.target.value)}>
              <option value="">Choisir une catégorie…</option>
              {[...addable]
                .sort((a, b) => {
                  const pa = a.parentId != null ? byId.get(a.parentId)?.name ?? '' : a.name;
                  const pb = b.parentId != null ? byId.get(b.parentId)?.name ?? '' : b.name;
                  return pa.localeCompare(pb) || a.name.localeCompare(b.name);
                })
                .map((c) => <option key={c.id} value={c.id}>{formatCategoryPath(c, byId)}</option>)}
            </select>
            <input
              className="input w-28" type="number" min="0" step="0.01"
              aria-label="Plafond mensuel" placeholder="Plafond €"
              value={newLimit} onChange={(e) => setNewLimit(e.target.value)}
            />
            <button className="btn-primary" onClick={submitNew} disabled={create.isPending}>Ajouter</button>
          </div>
        )}
      </div>
    </div>
  );
}
