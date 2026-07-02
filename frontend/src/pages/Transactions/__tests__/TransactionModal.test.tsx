import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TransactionModal } from '../TransactionModal';
import type { Account, Category, Transaction } from '../../../api/types';

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../../api/client';
const apiMock = vi.mocked(api);

// Labels are not wired with for/id, so locate the sibling control by DOM
// proximity instead of getByLabelText.
function fieldFor(labelText: string | RegExp): HTMLElement {
  const label = screen.getByText(labelText, { selector: 'label' });
  const control = label.parentElement?.querySelector('input, select, textarea');
  if (!control) throw new Error(`no control near label ${String(labelText)}`);
  return control as HTMLElement;
}

const accs: Account[] = [
  { id: 1, name: 'Compte', type: 'checking', currency: 'EUR', openingBalance: '0', openingDate: '2025-01-01' },
];
const cats: Category[] = [
  { id: 10, name: 'Courses', kind: 'expense', color: null, parentId: null, isDefault: false },
];

function renderModal(overrides: Partial<{
  open: boolean;
  transaction: Transaction | null;
  onClose: () => void;
}> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TransactionModal
        open={overrides.open ?? true}
        transaction={overrides.transaction ?? null}
        accounts={accs}
        categories={cats}
        onClose={overrides.onClose ?? (() => {})}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiMock.mockReset();
});

describe('TransactionModal', () => {
  it('renders the create form when open is true', () => {
    renderModal();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Créer la transaction' })).toBeInTheDocument();
  });

  it('renders nothing when open is false', () => {
    renderModal({ open: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('submits a POST with the shaped body in create mode', async () => {
    apiMock.mockResolvedValue({ transaction: { id: 999 } });
    const user = userEvent.setup();
    renderModal();

    await user.selectOptions(fieldFor('Compte'), '1');
    await user.clear(screen.getByPlaceholderText('JJ/MM/AAAA'));
    await user.type(screen.getByPlaceholderText('JJ/MM/AAAA'), '15/06/2026');
    await user.type(screen.getByPlaceholderText('-25,30'), '-42.30');
    await user.type(screen.getByPlaceholderText('Carrefour Évry'), 'CB CARREFOUR');
    await user.click(screen.getByRole('button', { name: 'Créer la transaction' }));

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/api/transactions', {
        method: 'POST',
        json: {
          accountId: 1,
          date: '2026-06-15',
          amount: '-42.30',
          rawLabel: 'CB CARREFOUR',
          categoryId: null,
          notes: null,
        },
      }),
    );
  });

  it('submits a PATCH with only the changed fields in edit mode', async () => {
    const original: Transaction = {
      id: 1, accountId: 1, date: '2026-06-15', amount: '-42.30',
      rawLabel: 'CB CARREFOUR', normalizedLabel: 'carrefour', memo: null, notes: null,
      fitid: null, dedupKey: 'dk-1', categoryId: null, categorySource: 'auto',
      transferGroupId: null, sourceFileId: null, importedAt: '2026-06-15T00:00:00Z',
    };
    apiMock.mockResolvedValue({ transaction: { ...original, rawLabel: 'CARREFOUR EVRY' } });
    const user = userEvent.setup();
    renderModal({ transaction: original });

    const labelInput = screen.getByPlaceholderText('Carrefour Évry');
    await user.clear(labelInput);
    await user.type(labelInput, 'CARREFOUR EVRY');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/api/transactions/1', {
        method: 'PATCH',
        json: { rawLabel: 'CARREFOUR EVRY' },
      }),
    );
  });

  it('does not submit when the required label field is left empty', async () => {
    apiMock.mockResolvedValue({ transaction: { id: 999 } });
    const user = userEvent.setup();
    renderModal();

    await user.selectOptions(fieldFor('Compte'), '1');
    await user.type(screen.getByPlaceholderText('-25,30'), '-42.30');
    await user.click(screen.getByRole('button', { name: 'Créer la transaction' }));

    // The rawLabel input carries the native `required` attribute, so jsdom
    // blocks the submit event before the component's handler runs.
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('fires onClose when the cancel button is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderModal({ onClose });

    await user.click(screen.getByRole('button', { name: 'Annuler' }));

    expect(onClose).toHaveBeenCalled();
  });
});
