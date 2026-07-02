import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { FileImportsList } from '../FileImportsList';
import type { Account, FileImport } from '../../../api/types';

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

function renderList(props: Partial<any> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <FileImportsList imports={rows} accounts={[acc]} onRequestDelete={vi.fn()} {...props} />
      </MemoryRouter>
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

  it('no longer exposes the stated-balance inline edit affordance', () => {
    renderList();
    // Historique table used to carry a "Renseigner" / stated-balance edit
    // row and a Solde déclaré / Δ column pair — both removed. Assert none
    // of that UI is present.
    expect(screen.queryByRole('button', { name: 'Renseigner' })).not.toBeInTheDocument();
    expect(screen.queryByText(/solde déclaré/i)).not.toBeInTheDocument();
    // Delta symbol used to sit as a column header.
    expect(screen.queryByRole('columnheader', { name: 'Δ' })).not.toBeInTheDocument();
  });
});
