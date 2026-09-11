import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Account, BalancePoint } from '../../api/types';
import { BalanceChart } from '../../components/BalanceChart';
import { ErrorState, LoadingBlock, EmptyState } from '../../components/StateBlocks';
import { AccountSelect } from '../Dashboard/AccountSelect';
import { amountSignClass, formatAmount } from '../../lib/format';
import { useForecastProjection } from '../Dashboard/useForecastProjection';
import { HISTORICAL_WINDOW_DAYS, isoDaysAgo, type Horizon } from './forecast-lib';
import { ForecastHorizonPicker } from './ForecastHorizonPicker';
import { useAutoStartTour } from '../../hooks/useAutoStartTour';
import { useTourAnchor } from '../../hooks/useTourAnchor';
import { TourReplayIcon } from '../../components/TourReplayIcon';

// Same average-based projection engine as the Dashboard Trend overlay —
// the "Épargne moyenne mensuelle" tile is what shapes the curve, so the
// two views can't drift. Replaying only the confirmed recurring series
// (a prior implementation) staircased upward when users confirmed their
// income but few outflows.
export function ForecastTab(): JSX.Element {
  const [horizon, setHorizon] = useState<Horizon>(60);
  const [scope, setScope] = useState<'all' | number>('all');

  const accountsQ = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api<{ accounts: Account[] }>('/api/accounts'),
  });
  const balanceQ = useQuery({
    queryKey: ['reports', 'balance'],
    queryFn: () => api<{ perCurrency: { currency: string; total: string }[] }>('/api/reports/balance'),
  });
  const timeseriesQ = useQuery({
    queryKey: ['reports', 'timeseries'],
    queryFn: () => api<{ points: BalancePoint[] }>('/api/reports/timeseries', { query: { granularity: 'day' } }),
  });

  const accounts = accountsQ.data?.accounts ?? [];
  const primaryCurrency = balanceQ.data?.perCurrency?.[0]?.currency ?? 'EUR';

  const currency = useMemo(() => {
    if (scope === 'all') return primaryCurrency;
    const acc = accounts.find((a) => a.id === scope);
    return acc?.currency ?? primaryCurrency;
  }, [scope, accounts, primaryCurrency]);

  const projection = useForecastProjection({
    enabled: true,
    chartScope: scope,
    chartCurrency: currency,
    accounts,
    perCurrency: balanceQ.data?.perCurrency,
    points: timeseriesQ.data?.points,
    horizonDays: horizon,
  });

  const scopedHistoricalPoints = useMemo<BalancePoint[]>(() => {
    const all = timeseriesQ.data?.points ?? [];
    const cutoff = isoDaysAgo(HISTORICAL_WINDOW_DAYS);
    const scoped = scope === 'all' ? all : all.filter((p) => p.account_id === scope);
    return scoped.filter((p) => p.bucket >= cutoff);
  }, [timeseriesQ.data, scope]);

  const startBalance = projection?.anchor ?? 0;
  const projectedEndBalance =
    projection && projection.points.length > 0
      ? projection.points[projection.points.length - 1]!.value
      : startBalance;
  const variation = projectedEndBalance - startBalance;

  useAutoStartTour('recurring-forecast');
  const chartAnchor = useTourAnchor('recurring-forecast:chart');
  const scopeAnchor = useTourAnchor('recurring-forecast:scope');

  if (accountsQ.isLoading || balanceQ.isLoading || timeseriesQ.isLoading) {
    return <LoadingBlock />;
  }
  if (accountsQ.error || balanceQ.error) {
    return (
      <ErrorState
        error={accountsQ.error ?? balanceQ.error}
        onRetry={() => {
          void accountsQ.refetch();
          void balanceQ.refetch();
        }}
      />
    );
  }

  const hasProjection = projection !== undefined;
  const monthCount = projection?.monthCount ?? 0;

  return (
    <div className="relative flex flex-col gap-6">
      <span ref={chartAnchor} aria-hidden className="pointer-events-none absolute right-4 top-4 h-1 w-1" />
      <span ref={scopeAnchor} aria-hidden className="pointer-events-none absolute right-16 top-4 h-1 w-1" />
      <div className="flex justify-end">
        <TourReplayIcon pageId="recurring-forecast" />
      </div>
      <section className="surface p-4 md:p-5">
        <div className="mb-4 flex items-center gap-3 flex-wrap">
          <span className="text-[10px] uppercase tracking-[0.18em] text-ink-500">
            Projection du solde ({currency})
          </span>
          <div className="flex-1 h-px bg-ink-800" />
          <div className="flex items-center gap-2 flex-wrap">
            <AccountSelect
              value={scope}
              // Same reason as the Dashboard forecast overlay: the 'available'
              // subset can't be averaged from the category report, so we hide
              // it and narrow the callback back to 'all' | number.
              onChange={(v) => {
                if (v !== 'available') setScope(v);
              }}
              accounts={accounts}
              primaryCurrency={primaryCurrency}
              hideAvailable
            />
            <ForecastHorizonPicker value={horizon} onChange={setHorizon} />
          </div>
        </div>
        <div className="text-[11px] text-ink-500 mb-3">
          {hasProjection
            ? `Projection basée sur l'épargne moyenne mensuelle des ${monthCount} dernier${monthCount > 1 ? 's' : ''} mois complet${monthCount > 1 ? 's' : ''}.`
            : "Pas encore assez d'historique pour projeter le solde."}
        </div>
        {timeseriesQ.error ? (
          <ErrorState variant="inline" error={timeseriesQ.error} onRetry={() => void timeseriesQ.refetch()} />
        ) : hasProjection ? (
          <BalanceChart
            points={scopedHistoricalPoints}
            projection={projection.points}
            currency={currency}
            alignEndTo={projection.anchor}
          />
        ) : (
          <EmptyState
            variant="inline"
            title="Pas encore assez d'historique"
            hint="La projection extrapole vos mois passés (revenus − dépenses). Il faut au moins un mois complet d'historique — hors mois d'ouverture du compte et mois en cours — pour lancer la courbe."
          />
        )}
      </section>

      {hasProjection && (
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="surface-soft px-4 py-3">
            <div className="label">Solde prévu à J+{horizon}</div>
            <div className={`display text-xl mt-0.5 tabular-nums ${amountSignClass(projectedEndBalance)}`}>
              {formatAmount(projectedEndBalance, currency)}
            </div>
          </div>
          <div className="surface-soft px-4 py-3">
            <div className="label">Variation prévue</div>
            <div className={`display text-xl mt-0.5 tabular-nums ${amountSignClass(variation)}`}>
              {variation >= 0 ? '+' : ''}
              {formatAmount(variation, currency)}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
