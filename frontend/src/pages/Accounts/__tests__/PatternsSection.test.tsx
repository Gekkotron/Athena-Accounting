import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PatternsSection } from '../PatternsSection';
import type { Account } from '../../../api/types';

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../../api/client';
const apiMock = vi.mocked(api);

function renderSection(patterns: any[] = [], accounts: Account[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PatternsSection patterns={patterns} accounts={accounts} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiMock.mockReset();
});

const acc: Account = {
  id: 1, name: 'Compte courant', type: 'checking', currency: 'EUR',
  openingBalance: '0.00', openingDate: '2025-01-01',
};

// The form fields render a plain `<label>` sibling next to the `<input>`/
// `<select>` without a `for`/`id` association, so `getByLabelText` cannot
// find them (same limitation documented in AccountForm.test.tsx). This
// helper locates the input by walking from the visible label text to its
// containing field wrapper.
function fieldFor(labelText: RegExp) {
  const label = screen.getByText(labelText, { selector: 'label' });
  const wrapper = label.parentElement as HTMLElement;
  const control = wrapper.querySelector('input, select');
  if (!control) throw new Error(`no input/select next to label matching ${labelText}`);
  return control as HTMLElement;
}

describe('PatternsSection', () => {
  it('renders the empty state when there are no patterns', () => {
    renderSection([], [acc]);
    expect(screen.getByText('Aucun motif configuré.')).toBeInTheDocument();
  });

  it('submits POST with the correct payload', async () => {
    apiMock.mockResolvedValueOnce({ pattern: { id: 1, pattern: 'compte_courant', accountId: 1, priority: 0 } });
    const user = userEvent.setup();
    renderSection([], [acc]);
    await user.type(fieldFor(/^motif$/i), 'compte_courant');
    await user.selectOptions(fieldFor(/^compte$/i), 'Compte courant');
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));

    expect(apiMock).toHaveBeenCalledWith('/api/account-filename-patterns', expect.objectContaining({
      method: 'POST',
      json: expect.objectContaining({ pattern: 'compte_courant' }),
    }));
  });

  it('submits DELETE when trash is clicked', async () => {
    apiMock.mockResolvedValueOnce({ ok: true });
    const user = userEvent.setup();
    renderSection([{ id: 42, pattern: 'x', accountId: 1, priority: 0 }], [acc]);
    await user.click(screen.getByRole('button', { name: 'supprimer' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/api/account-filename-patterns/42', expect.objectContaining({
      method: 'DELETE',
    })));
  });

  it('resolves account names from the accounts prop', () => {
    renderSection([{ id: 1, pattern: 'p', accountId: 1, priority: 0 }], [acc]);
    // "Compte courant" also appears as an <option> in the account <select>,
    // so scope the assertion to the pattern row's table cell.
    expect(screen.getByText('Compte courant', { selector: 'td' })).toBeInTheDocument();
  });
});
