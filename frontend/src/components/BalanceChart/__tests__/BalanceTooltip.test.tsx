import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BalanceTooltip } from '../BalanceTooltip';
import type { SeriesPoint } from '../series';
import type { CheckpointMark } from '../checkpoints';

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

describe('BalanceTooltip privacy mode', () => {
  // Privacy blur is CSS (html.privacy-on .private {...}), which jsdom can't
  // apply, so we assert the contract that makes it work: every money element
  // in the tooltip carries a blur trigger. The main value div uses
  // .font-mono.tabular-nums; the checkpoint amounts (which lack tabular-nums)
  // must opt in via .private, else they leak while everything else is hidden.
  const drifting: CheckpointMark = {
    date: '2026-06-14', expectedAmount: 2400, note: undefined,
    actual: 2300, delta: 100, drift: true, cx: 0,
  };

  it('marks the main balance with a blur trigger (font-mono + tabular-nums)', () => {
    const { container } = render(
      <BalanceTooltip hovered={hovered} hoveredCheckpoint={null} currency="EUR"
        x={100} y={50} containerWidth={1000} previousValue={2400} />,
    );
    // The blur CSS targets .font-mono.tabular-nums; the value (and its child
    // delta chip) live in exactly one such element.
    const blurred = container.querySelector('.font-mono.tabular-nums');
    expect(blurred).not.toBeNull();
    expect(blurred!.textContent).toMatch(/2\s?300/);
  });

  it('gives every checkpoint amount the .private escape hatch', () => {
    const { container } = render(
      <BalanceTooltip hovered={hovered} hoveredCheckpoint={drifting} currency="EUR"
        x={100} y={50} containerWidth={1000} previousValue={2400} />,
    );
    // attendu / réel / écart each show a euro amount; each must be inside a
    // .private (or blur-combo) element or it leaks under privacy mode.
    const privates = Array.from(container.querySelectorAll('.private')).map((e) => e.textContent);
    expect(privates.some((t) => /2\s?400/.test(t ?? ''))).toBe(true); // attendu
    expect(privates.some((t) => /2\s?300/.test(t ?? ''))).toBe(true); // réel
    expect(privates.some((t) => /100/.test(t ?? ''))).toBe(true);     // écart
  });
});
