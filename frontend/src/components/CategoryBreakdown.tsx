import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Category, CategoryReportRow } from '../api/types';
import { CategoryDonut, type CategorySegment } from './CategoryDonut';
import { RangePicker, fromDateFor, type RangeKey } from './RangePicker';

export type { RangeKey } from './RangePicker';
export type DonutMode = 'expense' | 'income';

interface Props {
  defaultRange?: RangeKey;
  defaultMode?: DonutMode;
  currency?: string;
  /** Optional controlled range. When provided, the internal range picker
      hides — the parent supplies the range (used on the Dashboard where a
      single top-of-page picker drives multiple surfaces). */
  range?: RangeKey;
  onRangeChange?: (r: RangeKey) => void;
}

export function CategoryBreakdown({
  defaultRange = '3m',
  defaultMode = 'expense',
  currency = 'EUR',
  range: controlledRange,
  onRangeChange,
}: Props) {
  const [internalRange, setInternalRange] = useState<RangeKey>(defaultRange);
  const [mode, setMode] = useState<DonutMode>(defaultMode);
  const isControlled = controlledRange !== undefined;
  const range = isControlled ? controlledRange : internalRange;
  const setRange = isControlled ? (onRangeChange ?? (() => {})) : setInternalRange;

  const fromDate = useMemo(() => fromDateFor(range), [range]);

  const reportQ = useQuery({
    queryKey: ['reports', 'categories', { fromDate: fromDate ?? 'all' }],
    queryFn: () =>
      api<{ rows: CategoryReportRow[] }>('/api/reports/categories', {
        query: fromDate ? { fromDate } : undefined,
      }),
  });
  const categoriesQ = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<{ categories: Category[] }>('/api/categories'),
  });

  const donutData: CategorySegment[] = useMemo(() => {
    const rows = reportQ.data?.rows ?? [];
    const cats = categoriesQ.data?.categories ?? [];
    const byCatId = new Map(cats.map((c) => [c.id, c] as const));

    // Aggregate the per-month rows into a single total per category, filtered
    // by sign so the donut only shows expenses or only revenues.
    const aggregated = new Map<number | null, number>();
    for (const row of rows) {
      const amt = Number(row.total);
      if (!Number.isFinite(amt) || amt === 0) continue;
      if (mode === 'expense' && amt >= 0) continue;
      if (mode === 'income' && amt <= 0) continue;
      const prev = aggregated.get(row.category_id) ?? 0;
      aggregated.set(row.category_id, prev + amt);
    }

    return Array.from(aggregated.entries())
      .map(([catId, sum]) => {
        const c = catId !== null ? byCatId.get(catId) : null;
        return {
          id: catId,
          name: c?.name ?? 'Sans catégorie',
          color: c?.color ?? null,
          amount: Math.abs(sum),
        } satisfies CategorySegment;
      })
      .filter((s) => s.amount > 0);
  }, [reportQ.data, categoriesQ.data, mode]);

  const isLoading = reportQ.isLoading || categoriesQ.isLoading;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-5 justify-end">
        {/* Range picker — hidden when the parent controls the range (the
            Dashboard's page-header picker drives every surface). */}
        {!isControlled && <RangePicker value={range} onChange={setRange} />}
        {/* Mode toggle */}
        <div className="inline-flex rounded-lg border border-ink-800 bg-ink-900/60 p-0.5 text-xs">
          <button
            onClick={() => setMode('expense')}
            className={`px-3 py-1.5 rounded-md transition ${
              mode === 'expense' ? 'bg-ink-850 text-ink-100' : 'text-ink-400 hover:text-ink-100'
            }`}
          >
            Dépenses
          </button>
          <button
            onClick={() => setMode('income')}
            className={`px-3 py-1.5 rounded-md transition ${
              mode === 'income' ? 'bg-ink-850 text-ink-100' : 'text-ink-400 hover:text-ink-100'
            }`}
          >
            Revenus
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="h-60 animate-pulse rounded-lg bg-ink-900" />
      ) : (
        <CategoryDonut
          data={donutData}
          currency={currency}
          centerLabel={mode === 'expense' ? 'Dépenses' : 'Revenus'}
        />
      )}
    </div>
  );
}
