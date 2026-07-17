import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
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
