import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import type { Account, Category, CategoryReportRow } from '../../api/types';
import {
  RangePicker,
  fromDateFor,
  rangeSuffixLabel,
  type RangeKey,
} from '../../components/RangePicker';
import { buildSankeyModel } from './sankey';
import { Sankey } from '../../components/Sankey';
import { AccountSelect } from './AccountSelect';

interface Props {
  range: RangeKey;
  onRangeChange: (r: RangeKey) => void;
  currency: string;
  /** When set to a specific account id, the report is filtered server-side
      to that account only. 'all' or undefined aggregates across every
      account the user owns. Mirrors the CategoryBreakdown contract. */
  accountId?: number | 'all';
  /** Accounts and setter for the header's compact scope dropdown. */
  accounts: Account[];
  onAccountChange: (v: 'all' | number) => void;
  primaryCurrency?: string;
}

export function SankeySection({
  range,
  onRangeChange,
  currency,
  accountId,
  accounts,
  onAccountChange,
  primaryCurrency,
}: Props): JSX.Element {
  const { t } = useTranslation('dashboard');
  const fromDate = fromDateFor(range);
  const scopedAccountId = typeof accountId === 'number' ? accountId : undefined;

  const catListQ = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<{ categories: Category[] }>('/api/categories'),
  });
  const reportQ = useQuery({
    queryKey: [
      'reports',
      'categories',
      { fromDate: fromDate ?? 'all', accountId: scopedAccountId ?? 'all' },
    ],
    queryFn: () =>
      api<{ rows: CategoryReportRow[] }>('/api/reports/categories', {
        query: {
          ...(fromDate ? { fromDate } : {}),
          ...(scopedAccountId ? { accountId: scopedAccountId } : {}),
        },
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
      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <span className="text-[10px] uppercase tracking-[0.18em] text-ink-500">
          {t('sankey.title', { currency })}{' '}
          <span className="text-ink-500 font-normal text-xs normal-case tracking-normal">
            — {rangeSuffixLabel(range)}
          </span>
        </span>
        <div className="flex-1 h-px bg-ink-800" />
        <div className="flex items-center gap-2 flex-wrap">
          <AccountSelect
            value={accountId ?? 'all'}
            onChange={onAccountChange}
            accounts={accounts}
            primaryCurrency={primaryCurrency}
          />
          <RangePicker value={range} onChange={onRangeChange} />
        </div>
      </div>

      {isLoading ? (
        <div className="h-40 animate-pulse rounded-lg bg-ink-900" />
      ) : isError ? (
        <div className="text-sm text-clay-300">{t('sankey.loadError')}</div>
      ) : model.totalIncome <= 0 ? (
        <div className="text-sm text-ink-400 display-italic">{t('sankey.noIncome')}</div>
      ) : (
        <Sankey model={model} />
      )}
    </section>
  );
}
