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
  it('renders name, spent/limit, and progress bar', () => {
    render(<BudgetRow row={row} depth={0} budgetId={10} onSave={() => {}} onDelete={() => {}} />);
    expect(screen.getByText('Restaurants')).toBeInTheDocument();
    expect(screen.getByText(/38,20/)).toBeInTheDocument();
    expect(screen.getByText(/50,00/)).toBeInTheDocument();
  });

  it('shows the anomaly chip when row.anomaly is true', () => {
    render(<BudgetRow row={row} depth={0} budgetId={10} onSave={() => {}} onDelete={() => {}} />);
    expect(screen.getByText(/anomalie/i)).toBeInTheDocument();
  });

  it('shows projected value and history avg when both are present', () => {
    render(<BudgetRow row={row} depth={0} budgetId={10} onSave={() => {}} onDelete={() => {}} />);
    expect(screen.getByText(/91,10/)).toBeInTheDocument();
    expect(screen.getByText(/49,92/)).toBeInTheDocument();
  });

  it('renders "—" instead of a projected value when projected is null', () => {
    render(<BudgetRow
      row={{ ...row, projected: null }}
      depth={0} budgetId={10} onSave={() => {}} onDelete={() => {}}
    />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows "Dépassé de X€" text when over is true', () => {
    render(<BudgetRow
      row={{ ...row, spent: '75.00', limit: '50.00', remaining: '-25.00', over: true, pct: 150 }}
      depth={0} budgetId={10} onSave={() => {}} onDelete={() => {}}
    />);
    expect(screen.getByText(/Dépassé de/)).toBeInTheDocument();
  });

  it('enters edit mode and saves on OK', () => {
    const onSave = vi.fn();
    render(<BudgetRow row={row} depth={0} budgetId={10} onSave={onSave} onDelete={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Modifier/i }));
    const input = screen.getByLabelText(/Modifier le plafond/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '75.00' } });
    fireEvent.click(screen.getByRole('button', { name: /^OK$/i }));
    expect(onSave).toHaveBeenCalledWith(10, '75.00');
  });

  it('accepts the French decimal comma when editing and saves it canonicalized', () => {
    const onSave = vi.fn();
    render(<BudgetRow row={row} depth={0} budgetId={10} onSave={onSave} onDelete={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Modifier/i }));
    const input = screen.getByLabelText(/Modifier le plafond/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '75,25' } });
    fireEvent.click(screen.getByRole('button', { name: /^OK$/i }));
    expect(onSave).toHaveBeenCalledWith(10, '75.25');
  });
});
