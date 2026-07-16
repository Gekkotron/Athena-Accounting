import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import type { CategoryReportRow } from '../../api/types';
import { StatWidget } from '../../components/StatWidget';
import { AVG_WINDOW_MONTHS, monthAgoISODate, lastDayOfPrevMonthISODate } from './helpers';

interface Props {
  currency: string;
}

export function MoyennesMensuellesSection({ currency }: Props): JSX.Element | null {
  const { t } = useTranslation('dashboard');
  const statsFromDate = monthAgoISODate(AVG_WINDOW_MONTHS);
  const statsToDate = lastDayOfPrevMonthISODate();
  const statsQ = useQuery({
    queryKey: ['reports', 'categories', { fromDate: statsFromDate, toDate: statsToDate }],
    queryFn: () =>
      api<{ rows: CategoryReportRow[] }>('/api/reports/categories', {
        query: { fromDate: statsFromDate, toDate: statsToDate },
      }),
  });

  const monthlyStats = useMemo(() => {
    const rows = statsQ.data?.rows ?? [];
    // Aggregate signed totals per month using the SIGN of the amount
    // (backend already excludes rows where transfer_group_id IS NOT NULL).
    // We also skip rows whose category is flagged `is_internal_transfer` so
    // users who don't rely on the auto mirror-leg detector — and instead tag
    // one side of a self-transfer with a dedicated category (e.g. "Épargne")
    // — get honest averages. Skipped from BOTH buckets so avgSavings stays
    // consistent (revenue − expenses cancels out on both legs).
    const monthly = new Map<string, { spend: number; income: number }>();
    for (const r of rows) {
      if (r.category_is_internal_transfer) continue;
      const cur = monthly.get(r.month) ?? { spend: 0, income: 0 };
      const amount = Number(r.total);
      if (!Number.isFinite(amount)) continue;
      if (amount < 0) cur.spend += amount;
      else if (amount > 0) cur.income += amount;
      monthly.set(r.month, cur);
    }
    // Guard against /0 when there is no history yet.
    const monthCount = monthly.size || 1;
    let totalSpend = 0;
    let totalIncome = 0;
    for (const v of monthly.values()) {
      totalSpend += v.spend;
      totalIncome += v.income;
    }
    return {
      monthCount: monthly.size,
      avgSpend: totalSpend / monthCount,
      avgIncome: totalIncome / monthCount,
      avgSavings: (totalIncome + totalSpend) / monthCount,
    };
  }, [statsQ.data]);

  if (statsQ.isLoading) return null;
  const hasHistory = monthlyStats.monthCount > 0;

  return (
    <section>
      <div className="section-rule mb-4">
        {t('moyennes.title')}{' '}
        <span className="text-ink-500 font-normal text-xs normal-case tracking-normal">
          {hasHistory
            ? t('moyennes.window', { count: monthlyStats.monthCount })
            : t('moyennes.noHistory')}
        </span>
      </div>
      {hasHistory ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <StatWidget
            icon="💸"
            label={t('moyennes.avgSpend.label')}
            value={monthlyStats.avgSpend}
            currency={currency}
            tone="clay"
            hint={t('moyennes.avgSpend.hint', { count: monthlyStats.monthCount })}
          />
          <StatWidget
            icon="💰"
            label={t('moyennes.avgIncome.label')}
            value={monthlyStats.avgIncome}
            currency={currency}
            tone="sage"
            hint={t('moyennes.avgIncome.hint', { count: monthlyStats.monthCount })}
          />
          <StatWidget
            icon="📈"
            label={t('moyennes.avgSavings.label')}
            value={monthlyStats.avgSavings}
            currency={currency}
            tone="auto"
            hint={t('moyennes.avgSavings.hint')}
          />
        </div>
      ) : (
        <div className="surface p-5 text-sm text-ink-400 display-italic">
          {t('moyennes.emptyState')}
        </div>
      )}
    </section>
  );
}
