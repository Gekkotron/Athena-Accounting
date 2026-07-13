import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { Account, BudgetPeriod, Category, BudgetReportRow } from '../../api/types';
import { useBudgets, useBudgetReport } from '../../lib/useBudgets';
import { formatAmount } from '../../lib/format';
import { formatCategoryPath, groupCategories } from '../../lib/categories';
import { PeriodSelector } from './PeriodSelector';
import { AccountFilter } from './AccountFilter';
import { SummaryCard } from './SummaryCard';

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function currentYear(): string {
  return String(new Date().getFullYear());
}

// Over budget is red (authoritative: server flags `over` as spent > limit, which
// survives pct rounding — e.g. 1004/1000 rounds to pct 100 but is still over).
// Otherwise amber from 80%, green below.
function barColor(pct: number, over: boolean): string {
  if (over) return 'bg-clay-500';
  if (pct >= 80) return 'bg-amber-500';
  return 'bg-sage-500';
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
  // so summing both rows double-counts it. Recompute a rollup-aware total
  // here for the SummaryCard by dropping any row whose direct parent is
  // itself budgeted (its spend already lives inside the parent's row).
  const summaryTotals = useMemo(() => {
    const topLevel = rows.filter((r) => {
      const parentId = byId.get(r.categoryId)?.parentId ?? null;
      return !(parentId != null && rowsByCategory.has(parentId));
    });
    const limit = topLevel.reduce((a, r) => a + Number(r.limit), 0);
    const spent = topLevel.reduce((a, r) => a + Number(r.spent), 0);
    const allProjected = topLevel.length > 0 && topLevel.every((r) => r.projected != null);
    const projected = allProjected
      ? topLevel.reduce((a, r) => a + Number(r.projected), 0).toFixed(2)
      : null;
    return {
      limit: limit.toFixed(2),
      spent: spent.toFixed(2),
      remaining: (limit - spent).toFixed(2),
      projected,
    };
  }, [rows, byId, rowsByCategory]);

  const [newCatId, setNewCatId] = useState('');
  const [newLimit, setNewLimit] = useState('');
  const [mutationError, setMutationError] = useState<string | null>(null);

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
          rows={report.data.rows}
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
              nodes.push(
                <BudgetLine
                  key={`root-${r.id}`}
                  row={rootRow}
                  depth={0}
                  budgetId={budgets.find((b) => b.categoryId === r.id)?.id}
                  onSave={handleSave}
                  onDelete={handleDelete}
                />,
              );
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
              nodes.push(
                <BudgetLine
                  key={`child-${c.id}`}
                  row={row}
                  depth={1}
                  budgetId={budgets.find((b) => b.categoryId === c.id)?.id}
                  onSave={handleSave}
                  onDelete={handleDelete}
                />,
              );
            }
            return nodes;
          })}
          {/* Also render any budgeted category whose parent isn't visible (orphaned leaf edge case). */}
          {rows
            .filter((r) => !visibleRoots.some((vr) => vr.id === r.categoryId || (childrenByParent.get(vr.id) ?? []).some((c) => c.id === r.categoryId)))
            .map((r) => (
              <BudgetLine
                key={`orphan-${r.categoryId}`}
                row={r}
                depth={0}
                budgetId={budgets.find((b) => b.categoryId === r.categoryId)?.id}
                onSave={handleSave}
                onDelete={handleDelete}
              />
            ))}
        </ul>
      )}

      <div className="surface p-4 flex flex-col gap-3">
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

function BudgetLine(props: {
  row: BudgetReportRow;
  depth: 0 | 1;
  budgetId: number | undefined;
  onSave: (id: number, limit: string) => void;
  onDelete: (id: number) => void;
}): JSX.Element {
  const { row: r, depth, budgetId, onSave, onDelete } = props;
  const pctClamped = Math.min(Math.max(r.pct, 0), 100);
  return (
    <li
      data-role="budget-row"
      data-depth={depth}
      className={`surface p-4 ${depth === 1 ? 'ml-8 bg-ink-900/20' : ''}`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium">{r.name}</span>
        <span className="text-sm tabular-nums private">
          {formatAmount(r.spent, r.currency)} / {Number(r.limit) > 0 ? formatAmount(r.limit, r.currency) : '—'}
        </span>
      </div>
      <div className="h-2 rounded-full bg-ink-800 overflow-hidden">
        <div className={`h-full ${barColor(r.pct, r.over)}`} style={{ width: `${pctClamped}%` }} />
      </div>
      <div className="flex items-center justify-between mt-2">
        <span className={`text-xs ${r.over ? 'text-clay-300' : 'text-ink-400'}`}>
          {r.over ? 'Dépassé de ' : 'Reste '}
          <span className="private">
            {r.over
              ? formatAmount((-Number(r.remaining)).toFixed(2), r.currency)
              : formatAmount(r.remaining, r.currency)}
          </span>
        </span>
        <BudgetRowActions
          id={budgetId}
          currentLimit={r.limit}
          onSave={onSave}
          onDelete={onDelete}
        />
      </div>
    </li>
  );
}

function BudgetRowActions(props: {
  id: number | undefined;
  currentLimit: string;
  onSave: (id: number, limit: string) => void;
  onDelete: (id: number) => void;
}) {
  const { id, currentLimit, onSave, onDelete } = props;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentLimit);
  if (id === undefined) return null;
  if (editing) {
    return (
      <span className="flex items-center gap-1">
        <input
          className="input w-24 !py-1" type="number" min="0" step="0.01"
          aria-label="Modifier le plafond" value={value} onChange={(e) => setValue(e.target.value)}
        />
        <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => {
          if (isValidLimit(value)) { onSave(id, value); setEditing(false); }
        }}>OK</button>
        <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => { setValue(currentLimit); setEditing(false); }}>Annuler</button>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => setEditing(true)}>Modifier</button>
      <button className="btn-ghost !py-1 !px-2 text-xs text-clay-300" onClick={() => onDelete(id)}>Supprimer</button>
    </span>
  );
}
