import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Category, CategoryReportRow } from '../api/types';
import { CategoryDonut, type CategorySegment } from './CategoryDonut';

export type RangeKey = '30d' | '3m' | '6m' | '12m' | 'all';
export type DonutMode = 'expense' | 'income';

const RANGES: { key: RangeKey; label: string; days: number | null }[] = [
  { key: '30d', label: '30 j',  days: 30  },
  { key: '3m',  label: '3 m',   days: 90  },
  { key: '6m',  label: '6 m',   days: 180 },
  { key: '12m', label: '12 m',  days: 365 },
  { key: 'all', label: 'Tout',  days: null },
];

function todayMinusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  // Use the local date — we don't need timezone precision here, only the day.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fromDateFor(range: RangeKey): string | undefined {
  const r = RANGES.find((x) => x.key === range);
  if (!r || r.days === null) return undefined;
  return todayMinusDays(r.days);
}

interface Props {
  defaultRange?: RangeKey;
  defaultMode?: DonutMode;
  currency?: string;
}

export function CategoryBreakdown({ defaultRange = '3m', defaultMode = 'expense', currency = 'EUR' }: Props) {
  const [range, setRange] = useState<RangeKey>(defaultRange);
  const [mode, setMode] = useState<DonutMode>(defaultMode);

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
        {/* Range picker */}
        <div className="inline-flex rounded-lg border border-ink-800 bg-ink-900/60 p-0.5 text-xs">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`px-2.5 py-1.5 rounded-md transition font-mono ${
                range === r.key
                  ? 'bg-ink-850 text-ink-100'
                  : 'text-ink-400 hover:text-ink-100'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
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
