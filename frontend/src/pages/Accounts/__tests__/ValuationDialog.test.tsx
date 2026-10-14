import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ValuationDialog } from '../ValuationDialog';
import type { Account } from '../../../api/types';
import { pinLocale } from '../../../test/i18n';

pinLocale('accounts');

vi.mock('../../../api/valuations', () => ({
  listValuations: vi.fn(),
  upsertValuation: vi.fn(),
  deleteValuation: vi.fn(),
}));

const acc: Account = {
  id: 5, name: 'AV', type: 'investment', currency: 'EUR',
  openingBalance: '1000.00', openingDate: '2025-01-01',
};

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ValuationDialog account={acc} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

describe('ValuationDialog', () => {
  beforeEach(async () => {
    const m = await import('../../../api/valuations');
    vi.mocked(m.listValuations).mockReset().mockResolvedValue([
      { id: 1, date: '2026-03-31', value: '1200.00', source: 'manual' },
    ]);
    vi.mocked(m.upsertValuation).mockReset().mockResolvedValue({ id: 2, date: '2026-04-01', value: '1234.56', source: 'manual' });
    vi.mocked(m.deleteValuation).mockReset().mockResolvedValue(undefined);
  });

  it('uses a text input with decimal keyboard (never type=number) and disables save until valid', () => {
    renderDialog();
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.type).toBe('text');
    expect(input.inputMode).toBe('decimal');
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
  });

  it('normalises a French decimal through parseDecimal before saving', async () => {
    const { upsertValuation } = await import('../../../api/valuations');
    renderDialog();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '1 234,56' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(upsertValuation).toHaveBeenCalled());
    const [id, body] = vi.mocked(upsertValuation).mock.calls[0]!;
    expect(id).toBe(5);
    expect(body.value).toBe('1234.56');
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('caps the date input at today', () => {
    const { container } = renderDialog();
    const date = container.querySelector('input[type="date"]') as HTMLInputElement;
    expect(date.max).toBe(date.value);
  });

  it('lists past valuations and deletes one', async () => {
    const { deleteValuation } = await import('../../../api/valuations');
    renderDialog();
    expect(await screen.findByText(/1\s?200,00/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Supprimer la valorisation/ }));
    await waitFor(() => expect(deleteValuation).toHaveBeenCalledWith(5, 1));
  });
});
