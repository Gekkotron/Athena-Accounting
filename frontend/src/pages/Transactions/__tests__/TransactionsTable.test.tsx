import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TransactionsTable } from '../TransactionsTable';
import type { Transaction, Category, Account } from '../../../api/types';
import type { Filters } from '../filters';
import { pinLocale } from '../../../test/i18n';

// TransactionsTable renders French strings by default (the app's current UI
// language). Preload the 'transactions'/'common' namespaces for both locales
// so `useTranslation` never suspends mid-render, then pin the active
// language to French so the existing French-literal assertions below keep
// matching real rendered text (per the i18n migration recipe's
// locale-preserving-helper fallback).
pinLocale('transactions');

const acc: Account = {
  id: 1,
  name: 'Compte',
  type: 'checking',
  currency: 'EUR',
  openingBalance: '0.00',
  openingDate: '2025-01-01',
};
const accountById = new Map([[acc.id, acc]]);
const cats: Category[] = [
  { id: 10, name: 'Courses', kind: 'expense', color: null, parentId: null, isDefault: false, isInternalTransfer: false },
];
const rows: Transaction[] = [
  {
    id: 1, accountId: 1, date: '2026-06-15', amount: '-10.00',
    rawLabel: 'A', normalizedLabel: 'a', memo: null, notes: null, fitid: null,
    dedupKey: 'x', categoryId: null, categorySource: 'auto',
    transferGroupId: null, sourceFileId: null, importedAt: '2026-06-15T00:00:00Z',
    splits: [],
  },
  {
    id: 2, accountId: 1, date: '2026-06-16', amount: '-20.00',
    rawLabel: 'B', normalizedLabel: 'b', memo: null, notes: null, fitid: null,
    dedupKey: 'y', categoryId: null, categorySource: 'auto',
    transferGroupId: null, sourceFileId: null, importedAt: '2026-06-16T00:00:00Z',
    splits: [],
  },
];
const baseFilters: Filters = { sort: 'date', order: 'desc' };

function renderTable(overrides: Partial<{
  transactions: Transaction[];
  isLoading: boolean;
  onEdit: (tx: Transaction) => void;
  onDelete: (tx: Transaction) => void;
}> = {}) {
  const setFilters = vi.fn();
  const setOffset = vi.fn();
  const onUpdateCategory = vi.fn();
  const onUpdateNotes = vi.fn();
  const onEdit = overrides.onEdit ?? vi.fn();
  const onDelete = overrides.onDelete ?? vi.fn();
  const onToggleSelect = vi.fn();
  const onToggleSelectAll = vi.fn();
  const onToggleExpanded = vi.fn();
  const onToggleCheckpoint = vi.fn();
  render(
    <TransactionsTable
      transactions={overrides.transactions ?? rows}
      categories={cats}
      accountById={accountById}
      isLoading={overrides.isLoading ?? false}
      filters={baseFilters}
      setFilters={setFilters}
      setOffset={setOffset}
      selectedIds={new Set()}
      onToggleSelect={onToggleSelect}
      onToggleSelectAll={onToggleSelectAll}
      onUpdateCategory={onUpdateCategory}
      onUpdateNotes={onUpdateNotes}
      onEdit={onEdit}
      onDelete={onDelete}
      expandedIds={new Set()}
      onToggleExpanded={onToggleExpanded}
      checkpointByDate={new Map()}
      pendingCheckpointDate={null}
      onToggleCheckpoint={onToggleCheckpoint}
    />,
  );
  return { setFilters, setOffset, onUpdateCategory, onUpdateNotes, onEdit, onDelete, onToggleSelect, onToggleSelectAll, onToggleExpanded };
}

describe('TransactionsTable', () => {
  it('renders one row per transaction', () => {
    renderTable();
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('shows "Aucune transaction." when transactions is empty and not loading', () => {
    renderTable({ transactions: [] });
    expect(screen.getByText('Aucune transaction.')).toBeInTheDocument();
  });

  it('shows "Chargement…" when transactions is empty and loading', () => {
    renderTable({ transactions: [], isLoading: true });
    expect(screen.getByText('Chargement…')).toBeInTheDocument();
  });

  it('calls setFilters and setOffset via Th when a sortable column header is clicked', async () => {
    const user = userEvent.setup();
    const { setFilters, setOffset } = renderTable();

    await user.click(screen.getByText('Libellé'));

    expect(setOffset).toHaveBeenCalledWith(0);
    expect(setFilters).toHaveBeenCalledTimes(1);
  });

  it('passes onEdit and onDelete through to each row', async () => {
    const user = userEvent.setup();
    const { onEdit, onDelete } = renderTable();

    const editButtons = screen.getAllByRole('button', { name: 'Modifier' });
    await user.click(editButtons[0]!);
    expect(onEdit).toHaveBeenCalledWith(rows[0]);

    const deleteButtons = screen.getAllByRole('button', { name: 'Supprimer' });
    await user.click(deleteButtons[1]!);
    expect(onDelete).toHaveBeenCalledWith(rows[1]);
  });
});
