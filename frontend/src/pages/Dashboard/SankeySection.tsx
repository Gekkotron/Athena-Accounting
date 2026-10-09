import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import type { CategoryReportRow } from '../../api/types';
import { useCategories } from '../../lib/useReferenceData';
import {
  fromDateFor,
  toDateFor,
  rangeSuffixLabel,
  type RangeKey,
} from '../../components/RangePicker';
import { buildSankeyModel } from './sankey';
import { Sankey } from '../../components/Sankey';
import { ErrorState, ChartSkeleton } from '../../components/StateBlocks';

interface Props {
  range: RangeKey;
  currency: string;
  /** When set to a specific account id, the report is filtered server-side
      to that account only. 'all' or undefined aggregates across every
      account the user owns. Mirrors the CategoryBreakdown contract. */
  accountId?: number | 'all' | 'available';
  /** Multi-account filter (wins over `accountId`). Drives the CSV
      `accountIds` server param — used by the Dashboard's "All available
      accounts" scope. */
  accountIds?: number[];
}

// The account dropdown and range picker live in the Dashboard's shared
// ChartScopeBar above this section, so this component only renders a label
// (with the range suffix) + the Sankey itself. The caller feeds `range` /
// `accountId` / `accountIds` down from the shared scope state.
export function SankeySection({
  range,
  currency,
  accountId,
  accountIds,
}: Props): JSX.Element {
  const { t } = useTranslation('dashboard');
  const { t: tCharts } = useTranslation('charts');
  // Month ranges are bounded on BOTH sides (last N complete months) so the
  // flow totals stay reconcilable with the Moyennes mensuelles tiles.
  const fromDate = fromDateFor(range);
  const toDate = toDateFor(range);
  const scopedAccountId = typeof accountId === 'number' ? accountId : undefined;
  // See CategoryBreakdown for the empty-accountIds rationale.
  const multiSelectExplicit = accountIds !== undefined;
  const multiSelectEmpty = multiSelectExplicit && accountIds.length === 0;
  const scopedAccountIds = accountIds && accountIds.length > 0
    ? Array.from(new Set(accountIds)).sort((a, b) => a - b)
    : undefined;
  const accountIdsKey = multiSelectEmpty
    ? '__empty__'
    : scopedAccountIds
      ? scopedAccountIds.join(',')
      : (scopedAccountId ?? 'all');

  const catListQ = useCategories();
  const reportQ = useQuery({
    queryKey: [
      'reports',
      'categories',
      { fromDate: fromDate ?? 'all', toDate: toDate ?? 'all', accountIds: accountIdsKey },
    ],
    queryFn: () =>
      api<{ rows: CategoryReportRow[] }>('/api/reports/categories', {
        query: {
          ...(fromDate ? { fromDate } : {}),
          ...(toDate ? { toDate } : {}),
          ...(scopedAccountIds
            ? { accountIds: scopedAccountIds.join(',') }
            : scopedAccountId
              ? { accountId: scopedAccountId }
              : {}),
        },
      }),
    enabled: !multiSelectEmpty,
  });

  const model = useMemo(
    () =>
      buildSankeyModel(reportQ.data?.rows ?? [], catListQ.data ?? [], currency, {
        otherLabel: tCharts('sankey.other'),
      }),
    [reportQ.data, catListQ.data, currency, tCharts],
  );

  const isLoading = catListQ.isLoading || reportQ.isLoading;
  const isError = catListQ.isError || reportQ.isError;

  return (
    <section className="surface p-5 md:p-6">
      <div className="section-rule mb-4">
        {t('sankey.title', { currency })}{' '}
        <span className="text-ink-500 font-normal text-xs normal-case tracking-normal">
          — {rangeSuffixLabel(range, tCharts)}
        </span>
      </div>

      {isLoading ? (
        <ChartSkeleton />
      ) : isError ? (
        <ErrorState
          variant="inline"
          title={t('sankey.loadError')}
          error={catListQ.error ?? reportQ.error}
          onRetry={() => {
            void catListQ.refetch();
            void reportQ.refetch();
          }}
        />
      ) : model.totalIncome <= 0 ? (
        <div className="text-sm text-ink-400 display-italic">{t('sankey.noIncome')}</div>
      ) : (
        <Sankey model={model} />
      )}
    </section>
  );
}
