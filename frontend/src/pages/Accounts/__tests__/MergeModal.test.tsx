import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MergeModal } from '../MergeModal';
import type { Account } from '../../../api/types';
import { pinLocale } from '../../../test/i18n';

// MergeModal uses both the 'accounts' namespace (title, warnings) and
// 'common' (Cancel). Preload both for both locales, pinned to French, so
// `useTranslation` never suspends and the existing French-literal
// assertions below keep matching real rendered text.
pinLocale('accounts');

const A = (id: number, name: string, currency: string, openingBalance = '0'): Account => ({
  id, name, type: 'checking', currency, openingBalance,
  openingDate: '2025-01-01', displayOrder: 0, createdAt: new Date().toISOString(),
  lockYears: null, currentBalance: '0', availableBalance: '0',
  transactionCount: 0, countedTransactionCount: 0,
});

vi.mock('../../../api/accounts', () => ({
  mergeAccount: vi.fn(),
}));

describe('MergeModal', () => {
  beforeEach(async () => {
    const { mergeAccount } = await import('../../../api/accounts');
    (mergeAccount as unknown as ReturnType<typeof vi.fn>).mockReset();
  });

  it('filters candidates by currency', () => {
    const source = A(1, 'Src', 'EUR');
    const candidates = [A(2, 'AnotherEUR', 'EUR'), A(3, 'ThirdEUR', 'EUR'), A(4, 'USD', 'USD')];
    render(
      <MergeModal open source={source} candidates={candidates}
        onCancel={() => {}} onDone={() => {}} />,
    );
    expect(screen.getByRole('option', { name: /AnotherEUR/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /ThirdEUR/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /USD/ })).not.toBeInTheDocument();
  });

  it('confirm button disabled until a target is chosen', () => {
    render(
      <MergeModal open source={A(1, 'Src', 'EUR')} candidates={[A(2, 'Tgt', 'EUR')]}
        onCancel={() => {}} onDone={() => {}} />,
    );
    const btn = screen.getByRole('button', { name: /^Fusionner$/ });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2' } });
    expect(btn).not.toBeDisabled();
  });

  it('calls onDone with the counts on success', async () => {
    const { mergeAccount } = await import('../../../api/accounts');
    (mergeAccount as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      transactionsMoved: 3, dedupCollisionsDropped: 0, transferGroupsCollapsed: 0,
      patternsMoved: 0, checkpointsMoved: 0, budgetsMoved: 0,
      importsMoved: 0, templatesMoved: 0, draftsMoved: 0,
      openingBalanceAdded: '10.00',
    });
    const onDone = vi.fn();
    render(
      <MergeModal open source={A(1, 'Src', 'EUR')} candidates={[A(2, 'Tgt', 'EUR')]}
        onCancel={() => {}} onDone={onDone} />,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /^Fusionner$/ }));
    await waitFor(() => {
      expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ transactionsMoved: 3 }));
    });
  });

  it('shows the API error inline and stays open on failure', async () => {
    const { mergeAccount } = await import('../../../api/accounts');
    (mergeAccount as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('currency mismatch'),
    );
    const onDone = vi.fn();
    render(
      <MergeModal open source={A(1, 'Src', 'EUR')} candidates={[A(2, 'Tgt', 'EUR')]}
        onCancel={() => {}} onDone={onDone} />,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /^Fusionner$/ }));
    await waitFor(() => {
      expect(screen.getByText(/currency mismatch/)).toBeInTheDocument();
    });
    expect(onDone).not.toHaveBeenCalled();
  });
});
