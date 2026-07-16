import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HoldModal } from '../HoldModal';

describe('HoldModal', () => {
  it('preset "Tout" fills the current pool available', () => {
    render(<HoldModal open month="2026-07" poolAvailable="500.00" onClose={vi.fn()} onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tout' }));
    expect(screen.getByLabelText(/Montant/i)).toHaveValue('500,00');
  });

  it('confirms with normalized amount', () => {
    const spy = vi.fn();
    render(<HoldModal open month="2026-07" poolAvailable="500.00" onClose={vi.fn()} onConfirm={spy} />);
    fireEvent.change(screen.getByLabelText(/Montant/i), { target: { value: '250,00' } });
    fireEvent.click(screen.getByRole('button', { name: /Retenir/i }));
    expect(spy).toHaveBeenCalledWith({ month: '2026-07', amount: '250.00' });
  });
});
