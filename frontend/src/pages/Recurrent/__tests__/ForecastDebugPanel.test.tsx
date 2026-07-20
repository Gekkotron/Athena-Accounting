import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ForecastDebugPanel } from '../ForecastDebugPanel';
import type { RecurringSeries } from '../../../api/types';
import type { ForecastPoint } from '../../../lib/recurring-forecast';

const series = (over: Partial<RecurringSeries>): RecurringSeries =>
  ({
    id: 1,
    label: 'Series',
    cadenceDays: 30,
    avgAmount: '10',
    amountStddev: '0',
    categoryId: null,
    firstSeenAt: '2026-01-01',
    lastSeenAt: '2026-07-01',
    nextDueAt: '2026-08-01',
    status: 'confirmed',
    essentialness: null,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    memberCount: 3,
    primaryAccountId: null,
    ...over,
  } as RecurringSeries);

const point = (over: Partial<ForecastPoint>): ForecastPoint => ({
  date: '2026-07-01',
  projectedBalance: 1000,
  contributions: [],
  ...over,
});

describe('ForecastDebugPanel', () => {
  it('renders the input snapshot (today, horizon, startBalance, scope, includeDetected)', () => {
    render(
      <ForecastDebugPanel
        today="2026-07-20"
        horizon={60}
        startBalance={1234.56}
        currency="EUR"
        scope="all"
        includeDetected={false}
        activeSeries={[]}
        rawForecast={[point({ date: '2026-07-20', projectedBalance: 1234.56 })]}
      />,
    );
    expect(screen.getByText('2026-07-20')).toBeInTheDocument();
    expect(screen.getByText('60 days')).toBeInTheDocument();
    // startBalance and projected-end both render "1234.56 EUR" when the
    // forecast is a single trivial day — two matches is expected.
    expect(screen.getAllByText('1234.56 EUR').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('all accounts')).toBeInTheDocument();
    expect(screen.getByText(/^false/)).toBeInTheDocument();
  });

  it('renders "account <n>" when scope is narrowed and "true" when includeDetected', () => {
    render(
      <ForecastDebugPanel
        today="2026-07-20"
        horizon={30}
        startBalance={0}
        currency="EUR"
        scope={42}
        includeDetected={true}
        activeSeries={[]}
        rawForecast={[point({ date: '2026-07-20', projectedBalance: 0 })]}
      />,
    );
    expect(screen.getByText('account 42')).toBeInTheDocument();
    expect(screen.getByText(/^true/)).toBeInTheDocument();
  });

  it('lists every activeSeries row with its label, status, cadence and account', () => {
    const rows = [
      series({ id: 1, label: 'Netflix', status: 'confirmed', cadenceDays: 30, primaryAccountId: 7 }),
      series({ id: 2, label: 'Random detected', status: 'detected', cadenceDays: 90, primaryAccountId: null }),
    ];
    render(
      <ForecastDebugPanel
        today="2026-07-20"
        horizon={30}
        startBalance={0}
        currency="EUR"
        scope="all"
        includeDetected={false}
        activeSeries={rows}
        rawForecast={[point({ date: '2026-07-20', projectedBalance: 0 })]}
      />,
    );
    expect(screen.getByText('Netflix')).toBeInTheDocument();
    expect(screen.getByText('Random detected')).toBeInTheDocument();
    expect(screen.getByText('30d')).toBeInTheDocument();
    expect(screen.getByText('90d')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    // At least one row without an accountId → em-dash placeholder cell.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('shows the "no projected occurrences" note when no forecast day has contributions', () => {
    render(
      <ForecastDebugPanel
        today="2026-07-20"
        horizon={30}
        startBalance={0}
        currency="EUR"
        scope="all"
        includeDetected={false}
        activeSeries={[]}
        rawForecast={[point({ date: '2026-07-20', projectedBalance: 0 })]}
      />,
    );
    expect(screen.getByText(/No projected occurrences/i)).toBeInTheDocument();
  });

  it('renders the contributions table when at least one day has activity', () => {
    const s = series({ id: 1, label: 'Netflix', avgAmount: '-15' });
    render(
      <ForecastDebugPanel
        today="2026-07-20"
        horizon={30}
        startBalance={1000}
        currency="EUR"
        scope="all"
        includeDetected={false}
        activeSeries={[s]}
        rawForecast={[
          point({ date: '2026-07-20', projectedBalance: 1000, contributions: [] }),
          point({
            date: '2026-08-01',
            projectedBalance: 985,
            contributions: [{ seriesId: 1, amount: -15 }],
          }),
        ]}
      />,
    );
    // Contributions table row: "Netflix -15.00" is the unique payload string,
    // built from label + amount by the debug panel's contributions renderer.
    expect(screen.getByText(/Netflix -15\.00/)).toBeInTheDocument();
    // Running balance for the only activity day appears once.
    expect(screen.getByText('985.00')).toBeInTheDocument();
  });
});
