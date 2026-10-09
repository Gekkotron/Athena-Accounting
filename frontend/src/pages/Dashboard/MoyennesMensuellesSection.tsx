import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import type { CategoryReportRow } from '../../api/types';
import { StatWidget } from '../../components/StatWidget';
import { StatGridSkeleton } from '../../components/StateBlocks';
import { SectionRule } from '../../components/SectionRule';
import { computeMonthlyStats } from './monthly-stats';
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

  const monthlyStats = useMemo(() => computeMonthlyStats(statsQ.data?.rows ?? []), [statsQ.data]);

  const hasHistory = monthlyStats.monthCount > 0;

  // Content-shaped skeleton while the categories report arrives — matches
  // the eventual 3-tile StatWidget grid so there's no layout shift. The
  // previous `return null` left a gap in the page's flex-col gap-10 stack.
  if (statsQ.isLoading) {
    return (
      <section>
        <SectionRule className="mb-4">{t('moyennes.title')}</SectionRule>
        <StatGridSkeleton n={3} />
      </section>
    );
  }

  return (
    <section>
      <SectionRule className="mb-4">
        {t('moyennes.title')}{' '}
        <span className="text-ink-500 font-normal text-xs normal-case tracking-normal">
          {hasHistory
            ? t('moyennes.window', { count: monthlyStats.monthCount })
            : t('moyennes.noHistory')}
        </span>
      </SectionRule>
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
