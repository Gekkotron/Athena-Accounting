import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { CategoryReportRow } from '../../api/types';
import { StatWidget } from '../../components/StatWidget';
import { AVG_WINDOW_MONTHS, monthAgoISODate, lastDayOfPrevMonthISODate } from './helpers';

interface Props {
  currency: string;
}

export function MoyennesMensuellesSection({ currency }: Props): JSX.Element | null {
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
    // (backend already excludes internal-transfer rows via
    //  `t.transfer_group_id IS NULL`). This way categories flagged
    // `neutral` — or not categorized at all — still land in the right
    // bucket instead of being silently dropped, which was the previous
    // failure mode for "why do all three widgets show 0€?".
    const monthly = new Map<string, { spend: number; income: number }>();
    for (const r of rows) {
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
        Moyennes mensuelles{' '}
        <span className="text-ink-500 font-normal text-xs normal-case tracking-normal">
          {hasHistory
            ? `— sur ${monthlyStats.monthCount} mois glissant${monthlyStats.monthCount > 1 ? 's' : ''}`
            : "— pas encore d'historique"}
        </span>
      </div>
      {hasHistory ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <StatWidget
            icon="💸"
            label="Dépense moyenne mensuelle"
            value={monthlyStats.avgSpend}
            currency={currency}
            tone="clay"
            hint={`Moyenne des sorties (hors virements internes) sur ${monthlyStats.monthCount} mois.`}
          />
          <StatWidget
            icon="💰"
            label="Revenu moyen mensuel"
            value={monthlyStats.avgIncome}
            currency={currency}
            tone="sage"
            hint={`Moyenne des entrées sur ${monthlyStats.monthCount} mois.`}
          />
          <StatWidget
            icon="📈"
            label="Épargne moyenne mensuelle"
            value={monthlyStats.avgSavings}
            currency={currency}
            tone="auto"
            hint="Revenus − dépenses, moyenne mensuelle."
          />
        </div>
      ) : (
        <div className="surface p-5 text-sm text-ink-400 display-italic">
          Importez au moins un mois complet de transactions pour voir les moyennes.
        </div>
      )}
    </section>
  );
}
