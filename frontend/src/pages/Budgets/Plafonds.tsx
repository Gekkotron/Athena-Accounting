import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ApiError } from '../../api/client';
import type { BudgetPeriod } from '../../api/types';
import { useBudgets, useBudgetReport } from '../../lib/useBudgets';
import { useAccounts, useCategories, EMPTY_ACCOUNTS, EMPTY_CATEGORIES } from '../../lib/useReferenceData';
import { ConsolidatedSummary } from './ConsolidatedSummary';
import { groupCategories } from '../../lib/categories';
import { useAutoStartTour } from '../../hooks/useAutoStartTour';
import { useTourAnchor } from '../../hooks/useTourAnchor';
import { TourReplayIcon } from '../../components/TourReplayIcon';
import { PeriodSelector } from './PeriodSelector';
import { AccountFilter } from './AccountFilter';
import { SummaryCard } from './SummaryCard';
import { BudgetRowsList } from './BudgetRowsList';
import { UnbudgetedSection } from './UnbudgetedSection';
import { AddBudgetForm } from './AddBudgetForm';
import { topLevelRows } from './budget-math';
import { ErrorState, LoadingBlock } from '../../components/StateBlocks';

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function currentYear(): string {
  return String(new Date().getFullYear());
}

function mutationErrorMessage(err: unknown, t: TFunction): string {
  return err instanceof ApiError ? err.message : t('mutationError.fallback');
}

export function Plafonds(): JSX.Element {
  const { t } = useTranslation('budgets');
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
  useAutoStartTour('budgets', {
    requireData: () => (budgets?.length ?? 0) > 0,
  });
  const catRowAnchor = useTourAnchor('budgets:category-row');
  const report = useBudgetReport({
    period,
    month: period === 'monthly' ? monthOrYear : undefined,
    year: period === 'yearly' ? monthOrYear : undefined,
    accountId,
  });
  const rows = useMemo(() => report.data?.rows ?? [], [report.data]);

  const accountsQ = useAccounts();
  const accounts = accountsQ.data ?? EMPTY_ACCOUNTS;

  const categoriesQ = useCategories();
  const cats = categoriesQ.data ?? EMPTY_CATEGORIES;
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
  const allCategories = cats;

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

  const [mutationError, setMutationError] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<{ categoryId: number; suggested: string } | null>(null);

  const handleSave = (id: number, limit: string) => update.mutate({ id, monthlyLimit: limit }, {
    onSuccess: () => setMutationError(null),
    onError: (err) => setMutationError(mutationErrorMessage(err, t)),
  });
  const handleDelete = (id: number) => remove.mutate(id, {
    onSuccess: () => setMutationError(null),
    onError: (err) => setMutationError(mutationErrorMessage(err, t)),
  });

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      {/* Header — stacks on mobile so the title, period picker, and
          account filter don't compete for the same 375px row. Grid
          restores at md+ where the three-column identity works. */}
      <div className="flex flex-col gap-4 md:grid md:grid-cols-3 md:items-center md:gap-3">
        <div className="md:justify-self-start">
          <div className="flex items-center gap-2">
            <h1 className="display text-2xl text-ink-50">{t('header.title')}</h1>
            <TourReplayIcon pageId="budgets" />
          </div>
          <p className="text-sm text-ink-400 mt-1">
            {t('header.subtitle')}
          </p>
        </div>
        <div className="md:justify-self-center">
          <PeriodSelector period={period} monthOrYear={monthOrYear} onChange={setPeriodState} />
        </div>
        <div className="md:justify-self-end">
          {accounts.length > 1 && (
            <AccountFilter accountId={accountId} accounts={accounts} onChange={setAccountFilter} />
          )}
        </div>
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

      {report.data?.consolidated && (
        <ConsolidatedSummary consolidated={report.data.consolidated} />
      )}

      {/* Row list + Suggestions + Unbudgeted + Add form — placeholders for
          Tasks 8–11. For this task, keep the existing per-row rendering,
          sourced from the new `report.data.rows` shape (a strict superset
          of the old one).                                                */}

      {report.isError ? (
        <ErrorState
          title={t('reportErrorTitle')}
          error={report.error}
          onRetry={() => void report.refetch()}
        />
      ) : report.isLoading ? (
        <LoadingBlock height="min-h-48" />
      ) : rows.length === 0 ? (
        <div className="surface p-8 text-center text-ink-400">
          <p className="mb-1">{t('emptyState.title')}</p>
          <p className="text-sm text-ink-500">{t('emptyState.hint')}</p>
        </div>
      ) : (
        <BudgetRowsList
          rows={rows}
          visibleRoots={visibleRoots}
          rowsByCategory={rowsByCategory}
          childrenByParent={childrenByParent}
          monthOrYear={monthOrYear}
          catRowAnchor={catRowAnchor}
          onSave={handleSave}
          onDelete={handleDelete}
          onApplySuggestion={(id, newLimit) => update.mutate({ id, monthlyLimit: newLimit })}
        />
      )}

      {report.data && (
        <UnbudgetedSection
          candidates={report.data.unbudgetedCandidates ?? []}
          period={period}
          onDefineBudget={(categoryId, suggested) => {
            setPrefill({ categoryId, suggested });
            document.getElementById('budgets-add-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }}
        />
      )}

      <AddBudgetForm
        categories={cats}
        accounts={accounts}
        budgets={budgets}
        candidates={report.data?.unbudgetedCandidates ?? []}
        prefill={prefill}
        onSubmit={(body) => create.mutate(body, {
          onSuccess: () => { setPrefill(null); setMutationError(null); },
          onError: (err) => setMutationError(mutationErrorMessage(err, t)),
        })}
        isPending={create.isPending}
      />
    </div>
  );
}
