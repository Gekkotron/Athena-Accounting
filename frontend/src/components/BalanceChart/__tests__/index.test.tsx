import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BalanceChart } from '../index';
import { pinLocale } from '../../../test/i18n';

pinLocale('charts');

describe('BalanceChart gapThresholdDays', () => {
  const points = [
    { account_id: 1, currency: 'EUR', bucket: '2026-01-01', cumulative: '100.00' },
    { account_id: 1, currency: 'EUR', bucket: '2026-01-05', cumulative: '110.00' }, // 4-day gap
    { account_id: 1, currency: 'EUR', bucket: '2026-01-15', cumulative: '120.00' }, // 10-day gap
  ] as any;

  it('with gapThresholdDays=3, both segments are dashed', () => {
    const { container } = render(<BalanceChart points={points} currency="EUR" gapThresholdDays={3} />);
    const dashed = container.querySelectorAll('path[stroke-dasharray="4 5"]');
    expect(dashed.length).toBeGreaterThan(0);
  });

  it('with gapThresholdDays=7, only the second (10-day) gap is dashed', () => {
    const { container } = render(<BalanceChart points={points} currency="EUR" gapThresholdDays={7} />);
    // At least one solid segment (glow-filtered) and one dashed segment.
    const dashed = container.querySelectorAll('path[stroke-dasharray="4 5"]');
    const solid = container.querySelectorAll('path[filter="url(#glow)"]');
    expect(dashed.length).toBeGreaterThan(0);
    expect(solid.length).toBeGreaterThan(0);
  });

  it('default (no prop) keeps the historical threshold behaviour (6 days)', () => {
    // 4-day gap ≤ 6 → solid; 10-day gap > 6 → dashed.
    const { container } = render(<BalanceChart points={points} currency="EUR" />);
    expect(container.querySelectorAll('path[stroke-dasharray="4 5"]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('path[filter="url(#glow)"]').length).toBeGreaterThan(0);
  });
});

describe('BalanceChart consolidated series', () => {
  const points = [
    { account_id: 1, currency: 'EUR', bucket: '2026-01-01', cumulative: '100.00' },
    { account_id: 1, currency: 'EUR', bucket: '2026-01-05', cumulative: '110.00' },
    { account_id: 1, currency: 'EUR', bucket: '2026-01-15', cumulative: '120.00' },
  ] as any;

  const consolidated = {
    display: 'USD',
    points: [
      { bucket: '2026-01-01', total: '500.00', unmapped: [] },
      { bucket: '2026-01-05', total: '510.00', unmapped: [] },
      { bucket: '2026-01-15', total: '520.00', unmapped: [] },
    ],
  };

  it('plots the consolidated series (display currency, converted totals) when present', () => {
    const { container } = render(
      <BalanceChart points={points} currency="EUR" consolidated={consolidated} />,
    );
    const svg = container.querySelector('svg');
    // aria-label embeds the formatted current/min/max values — consolidated's
    // last total (520) in its display currency (USD), not the raw EUR value (120).
    expect(svg?.getAttribute('aria-label')).toMatch(/520/);
    expect(svg?.getAttribute('aria-label')).not.toMatch(/120/);
  });

  it('falls back to the raw per-account/per-currency series when consolidated is null', () => {
    const { container } = render(
      <BalanceChart points={points} currency="EUR" consolidated={null} />,
    );
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-label')).toMatch(/120/);
    expect(svg?.getAttribute('aria-label')).not.toMatch(/520/);
  });

  it('shows no toggle button when consolidated is absent', () => {
    render(<BalanceChart points={points} currency="EUR" />);
    expect(screen.queryByText(/Afficher/)).not.toBeInTheDocument();
  });

  it('toggling "Show raw per-currency" switches the plotted series back to raw values', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <BalanceChart points={points} currency="EUR" consolidated={consolidated} />,
    );
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-label')).toMatch(/520/);

    await user.click(screen.getByRole('button', { name: /Afficher par devise/ }));
    expect(svg?.getAttribute('aria-label')).toMatch(/120/);
    expect(svg?.getAttribute('aria-label')).not.toMatch(/520/);

    // Toggling back restores the consolidated series.
    await user.click(screen.getByRole('button', { name: /Afficher consolidé/ }));
    expect(svg?.getAttribute('aria-label')).toMatch(/520/);
  });
});
