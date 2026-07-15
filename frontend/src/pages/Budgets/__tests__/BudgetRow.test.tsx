import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BudgetRow } from '../BudgetRow';

const row = {
  id: 1, categoryId: 42, name: 'Restaurants', color: null, parentId: null, accountId: null,
  period: 'monthly' as const, limit: '50.00', currency: 'EUR',
  spent: '38.20', remaining: '11.80', pct: 76, over: false,
  projected: '91.10',
  history: { values: ['42.15','51.30','48.90','55.10','39.80','62.25'], average: '49.92', median: '50.10' },
  anomaly: true,
  suggestedLimit: null,
};

describe('BudgetRow', () => {
  it('renders the category name and the primary status "Reste X sur Y" when on track', () => {
    render(<BudgetRow
      row={{ ...row, projected: '45.00', anomaly: false }}
      depth={0} budgetId={10} onSave={() => {}} onDelete={() => {}}
    />);
    expect(screen.getByText('Restaurants')).toBeInTheDocument();
    expect(screen.getByText(/Reste/)).toBeInTheDocument();
    expect(screen.getByText(/11,80/)).toBeInTheDocument();
    expect(screen.getByText(/50,00/)).toBeInTheDocument();
  });

  it('renders the amber "à surveiller" status when projected exceeds limit but not yet over', () => {
    render(<BudgetRow row={row} depth={0} budgetId={10} onSave={() => {}} onDelete={() => {}} />);
    expect(screen.getByText(/à surveiller/)).toBeInTheDocument();
    expect(screen.getByText(/11,80/)).toBeInTheDocument();
  });

  it('renders "Dépassé de X" when the row is over', () => {
    render(<BudgetRow
      row={{ ...row, spent: '75.00', limit: '50.00', remaining: '-25.00', over: true, pct: 150 }}
      depth={0} budgetId={10} onSave={() => {}} onDelete={() => {}}
    />);
    expect(screen.getByText(/Dépassé de/)).toBeInTheDocument();
    expect(screen.getByText(/25,00/)).toBeInTheDocument();
  });

  it('renders the muted trend clause with both "À ce rythme" and "Habituellement"', () => {
    render(<BudgetRow row={row} depth={0} budgetId={10} onSave={() => {}} onDelete={() => {}} />);
    expect(screen.getByText(/À ce rythme/)).toBeInTheDocument();
    expect(screen.getByText(/91,10/)).toBeInTheDocument();
    expect(screen.getByText(/Habituellement/)).toBeInTheDocument();
    expect(screen.getByText(/49,92/)).toBeInTheDocument();
  });

  it('renders the trend clause with only "Habituellement" when projected is null', () => {
    render(<BudgetRow
      row={{ ...row, projected: null }}
      depth={0} budgetId={10} onSave={() => {}} onDelete={() => {}}
    />);
    expect(screen.queryByText(/À ce rythme/)).toBeNull();
    expect(screen.getByText(/Habituellement/)).toBeInTheDocument();
  });

  it('hides the trend clause entirely when neither projected nor history is present', () => {
    render(<BudgetRow
      row={{ ...row, projected: null, history: null, anomaly: false }}
      depth={0} budgetId={10} onSave={() => {}} onDelete={() => {}}
    />);
    expect(screen.queryByText(/À ce rythme/)).toBeNull();
    expect(screen.queryByText(/Habituellement/)).toBeNull();
    expect(screen.queryByText(/inhabituel/)).toBeNull();
  });

  it('appends " · inhabituel" inline in the trend clause when row.anomaly is true', () => {
    render(<BudgetRow row={row} depth={0} budgetId={10} onSave={() => {}} onDelete={() => {}} />);
    expect(screen.getByText(/inhabituel/)).toBeInTheDocument();
  });

  it('does not render the old anomaly pill glyph nor the % overlay', () => {
    render(<BudgetRow row={row} depth={0} budgetId={10} onSave={() => {}} onDelete={() => {}} />);
    expect(screen.queryByText(/anomalie/i)).toBeNull();
    expect(screen.queryByText('76%')).toBeNull();
  });

  it('does not render a per-row sparkline SVG anymore', () => {
    const { container } = render(<BudgetRow row={row} depth={0} budgetId={10} onSave={() => {}} onDelete={() => {}} />);
    expect(container.querySelectorAll('svg').length).toBe(0);
  });

  it('enters edit mode and saves on OK (unchanged behavior)', () => {
    const onSave = vi.fn();
    render(<BudgetRow row={row} depth={0} budgetId={10} onSave={onSave} onDelete={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Modifier/i }));
    const input = screen.getByLabelText(/Modifier le plafond/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '75.00' } });
    fireEvent.click(screen.getByRole('button', { name: /^OK$/i }));
    expect(onSave).toHaveBeenCalledWith(10, '75.00');
  });

  it('accepts the French decimal comma and saves it canonicalized (unchanged behavior)', () => {
    const onSave = vi.fn();
    render(<BudgetRow row={row} depth={0} budgetId={10} onSave={onSave} onDelete={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Modifier/i }));
    const input = screen.getByLabelText(/Modifier le plafond/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '75,25' } });
    fireEvent.click(screen.getByRole('button', { name: /^OK$/i }));
    expect(onSave).toHaveBeenCalledWith(10, '75.25');
  });
});
