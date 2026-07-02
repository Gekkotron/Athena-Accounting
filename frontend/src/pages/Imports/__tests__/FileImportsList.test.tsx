import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FileImportsList } from '../FileImportsList';
import type { Account, FileImport } from '../../../api/types';

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../../api/client';
const apiMock = vi.mocked(api);

const acc: Account = {
  id: 1, name: 'Compte', type: 'checking', currency: 'EUR',
  openingBalance: '0', openingDate: '2025-01-01',
};

const rows: FileImport[] = [
  {
    id: 7, filename: 'a.csv', accountId: 1, format: 'csv',
    importedAt: '2026-06-15T00:00:00Z', totalLines: 10, insertedCount: 8,
    dedupSkipped: 2, statedBalance: null, statedBalanceDate: null,
    computedBalance: null, delta: null,
  },
];

// The reconcile fields render a plain `<label>` sibling next to the
// `<input>` without a `for`/`id` association, so `getByLabelText` cannot
// find them (same limitation documented in AccountForm.test.tsx).
function fieldFor(labelText: string | RegExp): HTMLElement {
  const label = screen.getByText(labelText, { selector: 'label' });
  const control = label.parentElement?.querySelector('input, select, textarea');
  if (!control) throw new Error(`no control near label ${String(labelText)}`);
  return control as HTMLElement;
}

function renderList(props: Partial<any> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FileImportsList imports={rows} accounts={[acc]} onRequestDelete={vi.fn()} {...props} />
    </QueryClientProvider>,
  );
}

describe('FileImportsList', () => {
  it('renders each import with filename, account, format and counts', () => {
    renderList();
    const row = screen.getByText('a.csv').closest('tr') as HTMLElement;
    expect(row).not.toBeNull();
    expect(within(row).getByText('Compte')).toBeInTheDocument();
    expect(within(row).getByText('csv')).toBeInTheDocument();
    expect(within(row).getByText('10')).toBeInTheDocument();
    expect(within(row).getByText('8')).toBeInTheDocument();
    expect(within(row).getByText('2')).toBeInTheDocument();
  });

  it('delete button fires onRequestDelete(fileImport)', async () => {
    const onRequestDelete = vi.fn();
    const user = userEvent.setup();
    renderList({ onRequestDelete });
    await user.click(screen.getByRole('button', { name: "Supprimer l'import" }));
    expect(onRequestDelete).toHaveBeenCalledWith(rows[0]);
  });

  it('stated-balance inline edit fires PATCH with { statedBalance, statedBalanceDate }', async () => {
    const patchCalls: Array<{ path: string; init: any }> = [];
    apiMock.mockImplementation(async (path: string, init?: any) => {
      if (init?.method === 'PATCH') {
        patchCalls.push({ path, init });
        return { fileImport: rows[0] };
      }
      throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
    });
    const user = userEvent.setup();
    renderList();

    await user.click(screen.getByRole('button', { name: 'Renseigner' }));
    // jsdom's `type="date"` input doesn't accept typed "YYYY-MM-DD" keystrokes,
    // so set it directly and fire the change event the component listens for.
    fireEvent.change(fieldFor('Date du solde'), { target: { value: '2026-06-30' } });
    await user.type(fieldFor('Solde déclaré (€)'), '1234,56');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => expect(patchCalls).toHaveLength(1));
    expect(patchCalls[0].path).toBe('/api/imports/7');
    expect(Object.keys(patchCalls[0].init.json)).toEqual(['statedBalance', 'statedBalanceDate']);
    expect(patchCalls[0].init.json).toEqual({ statedBalance: '1234.56', statedBalanceDate: '2026-06-30' });
  });
});
