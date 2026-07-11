import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Category, CategoryReportRow } from '../../api/types';
import {
  RANGES,
  fromDateFor,
  rangeSuffixLabel,
  type RangeKey,
} from '../../components/RangePicker';
import { buildSankeyModel } from './sankey';
import { Sankey } from '../../components/Sankey';

interface Props {
  range: RangeKey;
  onRangeChange: (r: RangeKey) => void;
  currency: string;
}

export function SankeySection({ range, onRangeChange, currency }: Props): JSX.Element {
  const fromDate = fromDateFor(range);

  const catListQ = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<{ categories: Category[] }>('/api/categories'),
  });
  const reportQ = useQuery({
    queryKey: ['reports', 'categories', { fromDate: fromDate ?? 'all', accountId: 'all' }],
    queryFn: () =>
      api<{ rows: CategoryReportRow[] }>('/api/reports/categories', {
        query: fromDate ? { fromDate } : {},
      }),
  });

  const model = useMemo(
    () => buildSankeyModel(reportQ.data?.rows ?? [], catListQ.data?.categories ?? [], currency),
    [reportQ.data, catListQ.data, currency],
  );

  const isLoading = catListQ.isLoading || reportQ.isLoading;
  const isError = catListQ.isError || reportQ.isError;

  // Order (short → long) matches the RangePicker segmented control.
  // ‹ steps to a LONGER range (further back in time), › to a SHORTER one —
  // same directional convention as Insights' month arrows.
  const rangeIndex = RANGES.findIndex((r) => r.key === range);
  const canLonger = rangeIndex >= 0 && rangeIndex < RANGES.length - 1;
  const canShorter = rangeIndex > 0;
  const stepLonger = () => {
    if (canLonger) onRangeChange(RANGES[rangeIndex + 1]!.key);
  };
  const stepShorter = () => {
    if (canShorter) onRangeChange(RANGES[rangeIndex - 1]!.key);
  };

  return (
    <section className="surface p-5 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="section-rule">
          Flux · {currency}{' '}
          <span className="text-ink-500 font-normal text-xs normal-case tracking-normal">
            — {rangeSuffixLabel(range)}
          </span>
        </div>
        <div className="inline-flex rounded-lg border border-ink-800 bg-ink-900/60 p-0.5 text-xs">
          <button
            onClick={stepLonger}
            disabled={!canLonger}
            className="px-2.5 py-1.5 rounded-md text-ink-400 transition hover:text-ink-100 disabled:opacity-30 disabled:hover:text-ink-400"
            aria-label="Période plus longue"
          >
            ‹
          </button>
          <button
            onClick={stepShorter}
            disabled={!canShorter}
            className="px-2.5 py-1.5 rounded-md text-ink-400 transition hover:text-ink-100 disabled:opacity-30 disabled:hover:text-ink-400"
            aria-label="Période plus courte"
          >
            ›
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="h-40 animate-pulse rounded-lg bg-ink-900" />
      ) : isError ? (
        <div className="text-sm text-clay-300">Erreur de chargement du flux.</div>
      ) : model.totalIncome <= 0 ? (
        <div className="text-sm text-ink-400 display-italic">Pas de revenus sur la période.</div>
      ) : (
        <Sankey model={model} />
      )}
    </section>
  );
}
