import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ForecastHorizonPicker } from '../ForecastHorizonPicker';
import { HORIZONS, type Horizon } from '../forecast-lib';

describe('ForecastHorizonPicker', () => {
  it('renders one button per canonical horizon, labelled "J+<n>"', () => {
    render(<ForecastHorizonPicker value={60} onChange={() => {}} />);
    for (const h of HORIZONS) {
      expect(screen.getByRole('button', { name: `J+${h}` })).toBeInTheDocument();
    }
  });

  it('highlights the currently-selected horizon with the active class', () => {
    render(<ForecastHorizonPicker value={90} onChange={() => {}} />);
    const active = screen.getByRole('button', { name: 'J+90' });
    const inactive = screen.getByRole('button', { name: 'J+30' });
    expect(active.className).toMatch(/bg-ink-800/);
    expect(inactive.className).not.toMatch(/bg-ink-800/);
  });

  it('calls onChange with the clicked horizon', () => {
    const onChange = vi.fn<(v: Horizon) => void>();
    render(<ForecastHorizonPicker value={30} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'J+180' }));
    expect(onChange).toHaveBeenCalledWith(180);
  });

  it('lets the user step through every horizon in sequence', () => {
    const onChange = vi.fn<(v: Horizon) => void>();
    render(<ForecastHorizonPicker value={30} onChange={onChange} />);
    for (const h of HORIZONS) {
      fireEvent.click(screen.getByRole('button', { name: `J+${h}` }));
    }
    expect(onChange.mock.calls.map((c) => c[0])).toEqual(HORIZONS);
  });
});
