import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Sparkline } from '../Sparkline';

describe('Sparkline', () => {
  it('renders a polyline with one point per value', () => {
    const { container } = render(<Sparkline values={[1, 5, 2, 8]} />);
    const poly = container.querySelector('polyline');
    expect(poly).not.toBeNull();
    // 4 points → 4 "x,y" pairs
    expect(poly!.getAttribute('points')!.trim().split(/\s+/)).toHaveLength(4);
  });

  it('renders a flat horizontal line when all values are equal', () => {
    const { container } = render(<Sparkline values={[3, 3, 3]} height={20} />);
    const poly = container.querySelector('polyline')!;
    const ys = poly
      .getAttribute('points')!
      .trim()
      .split(/\s+/)
      .map((p) => Number(p.split(',')[1]));
    // all y equal and centered (~height/2)
    expect(new Set(ys).size).toBe(1);
    expect(ys[0]).toBeCloseTo(10, 0);
  });

  it('renders a single dot for a one-element series', () => {
    const { container } = render(<Sparkline values={[42]} />);
    expect(container.querySelector('circle')).not.toBeNull();
    expect(container.querySelector('polyline')).toBeNull();
  });

  it('renders nothing meaningful for an empty series but does not crash', () => {
    const { container } = render(<Sparkline values={[]} />);
    expect(container.querySelector('polyline')).toBeNull();
    expect(container.querySelector('circle')).toBeNull();
  });

  it('exposes an accessible label when provided', () => {
    const { getByLabelText } = render(<Sparkline values={[1, 2]} aria-label="tendance" />);
    expect(getByLabelText('tendance')).toBeInTheDocument();
  });
});
