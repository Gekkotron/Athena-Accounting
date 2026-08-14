import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { RatesTable } from '../RatesTable';
import { pinLocale } from '../../../../test/i18n';

// RatesTable renders French labels by default (the app's current UI
// language). Preload the 'settings' namespace (and 'common', for the
// shared save/cancel labels used during inline edit) for both locales so
// `useTranslation` never suspends mid-render, then pin the active language
// to French so the French-literal assertions below keep matching real
// rendered text.
pinLocale('settings', 'common');

const rates = [
  { id: 1, from: 'USD', to: 'EUR', effectiveFrom: '2025-06-01', rate: '0.90' },
  { id: 2, from: 'USD', to: 'EUR', effectiveFrom: '2026-01-01', rate: '0.92' },
  { id: 3, from: 'GBP', to: 'EUR', effectiveFrom: '2025-01-01', rate: '1.15' },
];

function dataRows() {
  return screen.getAllByRole('row').slice(1); // drop the header row
}

describe('RatesTable', () => {
  it('sorts rows by from, to, effectiveFrom DESC', () => {
    render(<RatesTable rates={rates} onDelete={vi.fn()} onEdit={vi.fn()} />);
    const rows = dataRows();
    const froms = rows.map((r) => within(r).getAllByRole('cell')[0]?.textContent);
    expect(froms).toEqual(['GBP', 'USD', 'USD']);
    const usdDates = rows
      .filter((r) => within(r).getAllByRole('cell')[0]?.textContent === 'USD')
      .map((r) => within(r).getAllByRole('cell')[2]?.textContent);
    expect(usdDates).toEqual(['2026-01-01', '2025-06-01']);
  });

  it('calls onDelete with the row id when delete is clicked', () => {
    const onDelete = vi.fn();
    render(<RatesTable rates={rates} onDelete={onDelete} onEdit={vi.fn()} />);
    // Sorted order: GBP (id 3) is the first row.
    fireEvent.click(screen.getAllByRole('button', { name: /supprimer/i })[0]!);
    expect(onDelete).toHaveBeenCalledWith(3);
  });

  it('edits a row inline and calls onEdit with the new values', () => {
    const onEdit = vi.fn();
    render(<RatesTable rates={rates} onDelete={vi.fn()} onEdit={onEdit} />);
    // Sorted order: GBP (id 3) is the first row.
    fireEvent.click(screen.getAllByRole('button', { name: /modifier/i })[0]!);
    const rateInput = screen.getByDisplayValue('1.15');
    fireEvent.change(rateInput, { target: { value: '1,20' } });
    fireEvent.click(screen.getByRole('button', { name: /enregistrer/i }));
    expect(onEdit).toHaveBeenCalledWith({ id: 3, rate: '1.20', effectiveFrom: '2025-01-01' });
  });

  it('does not call onEdit when the edited rate cannot be parsed', () => {
    const onEdit = vi.fn();
    render(<RatesTable rates={rates} onDelete={vi.fn()} onEdit={onEdit} />);
    fireEvent.click(screen.getAllByRole('button', { name: /modifier/i })[0]!);
    fireEvent.change(screen.getByDisplayValue('1.15'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: /enregistrer/i }));
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getByText(/taux invalide/i)).toBeInTheDocument();
  });
});
