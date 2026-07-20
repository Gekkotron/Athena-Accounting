import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Account, BalancePoint, RecurringSeries } from '../../api/types';
import { BalanceChart } from '../../components/BalanceChart';
import { ErrorState, LoadingBlock, EmptyState } from '../../components/StateBlocks';
import { AccountSelect } from '../Dashboard/AccountSelect';
import { amountSignClass, formatAmount } from '../../lib/format';
import { projectBalance, type ForecastPoint } from '../../lib/recurring-forecast';
import {
  HISTORICAL_WINDOW_DAYS,
  classifyEmpty,
  contributingSeries,
  isoDaysAgo,
  todayIso,
  type Horizon,
} from './forecast-lib';
import { ForecastHorizonPicker } from './ForecastHorizonPicker';
import { ForecastDebugPanel } from './ForecastDebugPanel';

export function ForecastTab(): JSX.Element {
  const [horizon, setHorizon] = useState<Horizon>(60);
  const [scope, setScope] = useState<'all' | number>('all');
  const [includeDetected, setIncludeDetected] = useState(false);
  const [debug, setDebug] = useState<boolean>(
    typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('debug') === '1',
  );

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
  const seriesQ = useQuery({
    queryKey: ['recurring'],
    queryFn: () => api<{ recurring: RecurringSeries[] }>('/api/recurring'),
  });

  const accounts = accountsQ.data?.accounts ?? [];
  const primaryCurrency = balanceQ.data?.perCurrency?.[0]?.currency ?? 'EUR';

  const currency = useMemo(() => {
    if (scope === 'all') return primaryCurrency;
    const acc = accounts.find((a) => a.id === scope);
    return acc?.currency ?? primaryCurrency;
  }, [scope, accounts, primaryCurrency]);

  const startBalance = useMemo(() => {
    if (scope === 'all') {
      const total = balanceQ.data?.perCurrency?.find((c) => c.currency === currency)?.total ?? '0';
      return Number(total);
    }
    const acc = accounts.find((a) => a.id === scope);
    if (!acc) return 0;
    return Number(acc.currentBalance ?? acc.openingBalance ?? 0);
  }, [scope, accounts, balanceQ.data, currency]);

  // All non-dismissed series feed the counters/UI; the projection helper
  // then applies its own confirmed-only default (see includeDetected).
  // When the scope is narrowed to a specific account, series whose
  // primary account is a different account are dropped — otherwise a
  // salary that only lands on Checking would inflate the Savings
  // projection. Series with a null primaryAccountId (unknown) fall
  // through so old backend payloads remain compatible.
  const activeSeries = useMemo(() => {
    const all = (seriesQ.data?.recurring ?? []).filter((s) => s.status !== 'dismissed');
    if (scope === 'all') return all;
    return all.filter((s) => s.primaryAccountId == null || s.primaryAccountId === scope);
  }, [seriesQ.data, scope]);

  const contributingCount = useMemo(
    () => contributingSeries(activeSeries, includeDetected).length,
    [activeSeries, includeDetected],
  );

  const today = todayIso();

  const rawForecast = useMemo<ForecastPoint[]>(
    () =>
      projectBalance({
        startBalance,
        series: activeSeries,
        horizonDays: horizon,
        startDate: today,
        includeDetected,
      }),
    [startBalance, activeSeries, horizon, today, includeDetected],
  );

  const forecastPoints = useMemo(
    () =>
      // Skip index 0 (today) since the historical line already ends there —
      // otherwise the transition point renders twice.
      rawForecast.slice(1).map((p) => ({ date: p.date, value: p.projectedBalance })),
    [rawForecast],
  );

  const scopedHistoricalPoints = useMemo<BalancePoint[]>(() => {
    const all = timeseriesQ.data?.points ?? [];
    const cutoff = isoDaysAgo(HISTORICAL_WINDOW_DAYS);
    const scoped = scope === 'all' ? all : all.filter((p) => p.account_id === scope);
    return scoped.filter((p) => p.bucket >= cutoff);
  }, [timeseriesQ.data, scope]);

  const projectedEndBalance = forecastPoints.length > 0
    ? forecastPoints[forecastPoints.length - 1]!.value
    : startBalance;
  const variation = projectedEndBalance - startBalance;

  if (accountsQ.isLoading || balanceQ.isLoading || timeseriesQ.isLoading || seriesQ.isLoading) {
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

  const allUserSeries = (seriesQ.data?.recurring ?? []).filter((s) => s.status !== 'dismissed');
  const emptyKind = classifyEmpty({
    contributingCount,
    scope,
    allUserSeriesCount: allUserSeries.length,
    activeSeriesCount: activeSeries.length,
    includeDetected,
  });

  return (
    <div className="flex flex-col gap-6">
      <section className="surface p-4 md:p-5">
        <div className="mb-4 flex items-center gap-3 flex-wrap">
          <span className="text-[10px] uppercase tracking-[0.18em] text-ink-500">
            Projection du solde ({currency})
          </span>
          <div className="flex-1 h-px bg-ink-800" />
          <div className="flex items-center gap-2 flex-wrap">
            <label
              className="flex items-center gap-1.5 text-xs text-ink-400 cursor-pointer select-none"
              title="Par défaut, seules les séries confirmées alimentent la projection. Activez pour inclure aussi les séries détectées non-confirmées."
            >
              <input
                type="checkbox"
                checked={includeDetected}
                onChange={(e) => setIncludeDetected(e.target.checked)}
                className="accent-sage-500"
              />
              Inclure séries détectées
            </label>
            <AccountSelect
              value={scope}
              onChange={setScope}
              accounts={accounts}
              primaryCurrency={primaryCurrency}
            />
            <ForecastHorizonPicker value={horizon} onChange={setHorizon} />
          </div>
        </div>
        <div className="text-[11px] text-ink-500 mb-3">
          {emptyKind === null
            ? `Projection basée sur ${contributingCount} série${contributingCount > 1 ? 's' : ''} ${includeDetected ? 'active' : 'confirmée'}${contributingCount > 1 ? 's' : ''}.`
            : emptyKind === 'scope'
              ? "Aucune série récurrente ne concerne principalement ce compte."
              : emptyKind === 'unconfirmed'
                ? "Aucune série confirmée pour l'instant."
                : "Aucune série récurrente pour projeter le solde."}
        </div>
        {timeseriesQ.error ? (
          <ErrorState variant="inline" error={timeseriesQ.error} onRetry={() => void timeseriesQ.refetch()} />
        ) : emptyKind === null ? (
          <BalanceChart
            points={scopedHistoricalPoints}
            projection={forecastPoints}
            currency={currency}
            alignEndTo={startBalance}
          />
        ) : (
          <EmptyState
            variant="inline"
            title={
              emptyKind === 'scope'
                ? 'Aucune série sur ce compte'
                : emptyKind === 'unconfirmed'
                  ? "Aucune série confirmée pour l'instant."
                  : 'Aucune série récurrente pour projeter le solde.'
            }
            hint={
              emptyKind === 'scope'
                ? "La projection ne montre que les séries récurrentes attribuées à ce compte. Sélectionnez « Tous les comptes » ci-dessus pour retrouver une projection combinée, ou choisissez le compte sur lequel votre salaire et vos prélèvements atterrissent."
                : emptyKind === 'unconfirmed'
                  ? "La projection n'utilise que les séries que vous avez confirmées, pour éviter que des détections approximatives ne faussent le résultat. Ouvrez l'onglet Détectés et confirmez vos vraies séries récurrentes — ou activez « inclure les séries détectées » ci-dessus pour projeter avec l'ensemble."
                  : "Confirmez d'abord vos séries récurrentes depuis l'onglet Détectés — la projection utilise leurs cadences et montants pour extrapoler la trajectoire de votre solde."
            }
            action={
              emptyKind === 'scope' ? (
                <button type="button" className="btn-ghost text-xs" onClick={() => setScope('all')}>
                  Voir tous les comptes
                </button>
              ) : emptyKind === 'unconfirmed' ? (
                <button type="button" className="btn-ghost text-xs" onClick={() => setIncludeDetected(true)}>
                  Inclure les séries détectées
                </button>
              ) : undefined
            }
          />
        )}
      </section>

      {emptyKind === null && (
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

      <div className="text-right">
        <button
          type="button"
          onClick={() => setDebug((d) => !d)}
          className="text-[10px] uppercase tracking-[0.18em] text-ink-500 hover:text-ink-200 underline-offset-2 hover:underline"
        >
          {debug ? '[hide debug]' : '[debug]'}
        </button>
      </div>

      {debug && (
        <ForecastDebugPanel
          today={today}
          horizon={horizon}
          startBalance={startBalance}
          currency={currency}
          scope={scope}
          includeDetected={includeDetected}
          activeSeries={activeSeries}
          rawForecast={rawForecast}
        />
      )}
    </div>
  );
}
