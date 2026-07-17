import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReallocateModal } from '../ReallocateModal';
import { pinLocale } from '../../../../test/i18n';

pinLocale('budgets');

const rows = [
  { categoryId: 1, categoryName: 'A', assignment: '100.00', balance: '100.00' },
  { categoryId: 2, categoryName: 'B', assignment: '50.00', balance: '50.00' },
] as any;

describe('ReallocateModal', () => {
  it('does not confirm when source == dest', () => {
    const spy = vi.fn();
    render(<ReallocateModal
      open source={rows[0]} rows={rows} month="2026-07"
      onClose={vi.fn()} onConfirm={spy}
    />);
    const confirm = screen.getByRole('button', { name: /Confirmer/i });
    // default target is source; button should be disabled
    expect(confirm).toBeDisabled();
  });

  it('confirms with correct payload', () => {
    const spy = vi.fn();
    render(<ReallocateModal
      open source={rows[0]} rows={rows} month="2026-07"
      onClose={vi.fn()} onConfirm={spy}
    />);
    fireEvent.change(screen.getByLabelText(/Vers/i), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/Montant/i), { target: { value: '30,00' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirmer/i }));
    expect(spy).toHaveBeenCalledWith({ fromCategoryId: 1, toCategoryId: 2, month: '2026-07', amount: '30.00' });
  });
});
