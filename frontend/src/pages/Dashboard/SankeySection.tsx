import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Category, CategoryReportRow } from '../../api/types';
import { fromDateFor, type RangeKey } from '../../components/RangePicker';
import { buildSankeyModel } from './sankey';
import { Sankey } from '../../components/Sankey';

interface Props { range: RangeKey; currency: string; }

export function SankeySection({ range, currency }: Props): JSX.Element {
  const fromDate = fromDateFor(range);

  const catListQ = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<{ categories: Category[] }>('/api/categories'),
  });
  const reportQ = useQuery({
    queryKey: ['reports', 'categories', { fromDate }],
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

  return (
    <section className="surface p-5 md:p-6">
      <div className="section-rule mb-4">Flux · {currency}</div>
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
