import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BalanceTooltip } from '../BalanceTooltip';
import type { SeriesPoint } from '../series';

const hovered: SeriesPoint = { date: '2026-06-15', value: 2300 };

function renderTooltip(previousValue: number | null) {
  return render(
    <BalanceTooltip
      hovered={hovered}
      hoveredCheckpoint={null}
      currency="EUR"
      x={100}
      y={50}
      containerWidth={1000}
      previousValue={previousValue}
    />,
  );
}

describe('BalanceTooltip diff-from-last-point chip', () => {
  it('shows a negative delta when the balance dropped', () => {
    renderTooltip(2400);
    const chip = screen.getByTestId('tooltip-delta');
    // 2300 - 2400 = -100. Intl renders the sign; assert magnitude + minus.
    expect(chip.textContent).toContain('100');
    expect(chip.textContent).toMatch(/[-−]/);
    expect(chip.textContent).not.toContain('+');
  });

  it('prepends an explicit + when the balance rose', () => {
    renderTooltip(2250);
    const chip = screen.getByTestId('tooltip-delta');
    // 2300 - 2250 = +50.
    expect(chip.textContent).toContain('+');
    expect(chip.textContent).toContain('50');
  });

  it('renders no chip at the very first point (no previous value)', () => {
    renderTooltip(null);
    expect(screen.queryByTestId('tooltip-delta')).toBeNull();
  });
});
