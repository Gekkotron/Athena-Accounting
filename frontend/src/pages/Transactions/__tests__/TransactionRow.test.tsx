import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TransactionRow } from '../TransactionRow';
import type { Transaction, Category, Account, BalanceCheckpoint } from '../../../api/types';
import i18n from '../../../i18n';

// TransactionRow renders French strings by default (the app's current UI
// language). Preload the 'transactions'/'common' namespaces for both locales
// so `useTranslation` never suspends mid-render, then pin the active
// language to French so the existing French-literal assertions below keep
// matching real rendered text (per the i18n migration recipe's
// locale-preserving-helper fallback).
beforeAll(async () => {
  await i18n.changeLanguage('fr');
  await i18n.loadNamespaces(['transactions', 'common']);
});

const acc: Account = {
  id: 1,
  name: 'Compte',
  type: 'checking',
  currency: 'EUR',
  openingBalance: '0.00',
  openingDate: '2025-01-01',
};
const cats: Category[] = [
  { id: 10, name: 'Livres', kind: 'expense', color: null, parentId: null, isDefault: false, isInternalTransfer: false },
  { id: 11, name: 'Électro', kind: 'expense', color: null, parentId: null, isDefault: false, isInternalTransfer: false },
  { id: 41, name: 'Courses', kind: 'expense', color: null, parentId: null, isDefault: false, isInternalTransfer: false },
  { id: 42, name: 'Alimentation', kind: 'expense', color: null, parentId: 41, isDefault: false, isInternalTransfer: false },
];
const t: Transaction = {
  id: 1,
  accountId: 1,
  date: '2026-06-15',
  amount: '-42.30',
  rawLabel: 'CB CARREFOUR',
  normalizedLabel: 'carrefour',
  memo: null,
  notes: null,
  fitid: null,
  dedupKey: 'dk-1',
  categoryId: null,
  categorySource: 'auto',
  transferGroupId: null,
  sourceFileId: null,
  importedAt: '2026-06-15T00:00:00Z',
  splits: [],
};

const splitTx: Transaction = {
  id: 42,
  accountId: 1,
  date: '2026-07-04',
  amount: '-100.00',
  rawLabel: 'Amazon FR',
  normalizedLabel: 'amazon',
  memo: null,
  notes: null,
  fitid: null,
  dedupKey: 'dk-42',
  categoryId: null,
  categorySource: 'manual',
  transferGroupId: null,
  sourceFileId: null,
  importedAt: '2026-07-04T00:00:00Z',
  splits: [
    { id: 1, transactionId: 42, categoryId: 10, amount: '-60.00', memo: 'Kindle' },
    { id: 2, transactionId: 42, categoryId: 11, amount: '-40.00', memo: null },
  ],
};

function txWithCategory(categoryId: number): Transaction {
  return { ...t, categoryId };
}

function renderRow(
  overrides: Partial<{
    tx: Transaction;
    selected: boolean;
    expanded: boolean;
    showBalance: boolean;
    onToggleExpanded: (id: number) => void;
    isEndOfDay: boolean;
    checkpoint: BalanceCheckpoint | undefined;
    checkpointPending: boolean;
    onToggleCheckpoint: (tx: Transaction, checked: boolean) => void;
  }> = {},
) {
  const tx = overrides.tx ?? t;
  const onUpdateCategory = vi.fn();
  const onUpdateNotes = vi.fn();
  const onEdit = vi.fn();
  const onDelete = vi.fn();
  const onToggleSelect = vi.fn();
  const onToggleExpanded = overrides.onToggleExpanded ?? (() => {});
  const onToggleCheckpoint = overrides.onToggleCheckpoint ?? vi.fn();
  const result = render(
    <table>
      <tbody>
        <TransactionRow
          tx={tx}
          account={acc}
          categories={cats}
          selected={overrides.selected ?? false}
          onToggleSelect={onToggleSelect}
          onUpdateCategory={onUpdateCategory}
          onUpdateNotes={onUpdateNotes}
          onEdit={onEdit}
          onDelete={onDelete}
          expanded={overrides.expanded ?? false}
          onToggleExpanded={onToggleExpanded}
          showBalance={overrides.showBalance ?? false}
          isEndOfDay={overrides.isEndOfDay ?? false}
          checkpoint={overrides.checkpoint}
          checkpointPending={overrides.checkpointPending ?? false}
          onToggleCheckpoint={onToggleCheckpoint}
        />
      </tbody>
    </table>,
  );
  return { onUpdateCategory, onUpdateNotes, onEdit, onDelete, onToggleSelect, onToggleCheckpoint, container: result.container };
}

describe('TransactionRow', () => {
  it('renders date, account name, label, and amount', () => {
    renderRow();

    expect(screen.getByText('15/06/2026')).toBeInTheDocument();
    expect(screen.getByText('CB CARREFOUR')).toBeInTheDocument();
    expect(screen.getAllByText('Compte').length).toBeGreaterThan(0);
    expect(screen.getByText(/42,30/)).toBeInTheDocument();
  });

  it('fires onUpdateCategory with a single-field categoryId patch', async () => {
    const user = userEvent.setup();
    const { onUpdateCategory } = renderRow();

    await user.selectOptions(screen.getByRole('combobox'), '10');

    expect(onUpdateCategory).toHaveBeenCalledTimes(1);
    expect(onUpdateCategory).toHaveBeenCalledWith(1, { categoryId: 10 });
    const patch = onUpdateCategory.mock.calls[0]![1];
    expect(Object.keys(patch)).toEqual(['categoryId']);
  });

  it('fires onUpdateNotes with a single-field notes patch on blur', async () => {
    const user = userEvent.setup();
    const { onUpdateNotes } = renderRow();

    const notesInput = screen.getByPlaceholderText('…');
    await user.type(notesInput, 'ma note');
    await user.tab();

    expect(onUpdateNotes).toHaveBeenCalledTimes(1);
    expect(onUpdateNotes).toHaveBeenCalledWith(1, { notes: 'ma note' });
    const patch = onUpdateNotes.mock.calls[0]![1];
    expect(Object.keys(patch)).toEqual(['notes']);
  });

  it('does not fire onUpdateNotes when the value is unchanged on blur', async () => {
    const user = userEvent.setup();
    const { onUpdateNotes } = renderRow();

    const notesInput = screen.getByPlaceholderText('…');
    await user.click(notesInput);
    await user.tab();

    expect(onUpdateNotes).not.toHaveBeenCalled();
  });

  it('fires onEdit(tx) when the pencil button is clicked', async () => {
    const user = userEvent.setup();
    const { onEdit } = renderRow();

    await user.click(screen.getByRole('button', { name: 'Modifier' }));

    expect(onEdit).toHaveBeenCalledWith(t);
  });

  it('fires onDelete(tx) when the delete button is clicked', async () => {
    const user = userEvent.setup();
    const { onDelete } = renderRow();

    await user.click(screen.getByRole('button', { name: 'Supprimer' }));

    expect(onDelete).toHaveBeenCalledWith(t);
  });

  it('fires onToggleSelect(id, true) when the row checkbox is checked', async () => {
    const user = userEvent.setup();
    const { onToggleSelect } = renderRow();

    const cb = screen.getByRole('checkbox', { name: /sélectionner la transaction/i });
    expect(cb).not.toBeChecked();
    await user.click(cb);

    expect(onToggleSelect).toHaveBeenCalledWith(t.id, true);
  });

  it('renders the row checkbox as checked when selected=true', () => {
    renderRow({ selected: true });
    expect(screen.getByRole('checkbox', { name: /sélectionner la transaction/i })).toBeChecked();
  });

  it('renders a "Ventilée (N)" badge in place of the category select when split', () => {
    const { container } = renderRow({ tx: splitTx, expanded: false });
    expect(screen.getByRole('button', { name: /Ventilée \(2\)/ })).toBeInTheDocument();
    expect(container.querySelector('select')).not.toBeInTheDocument();
  });

  it('emits sub-rows when expanded is true', () => {
    renderRow({ tx: splitTx, expanded: true });
    expect(screen.getByText(/Livres/)).toBeInTheDocument();
    expect(screen.getByText(/Électro/)).toBeInTheDocument();
  });

  it('clicking the badge calls onToggleExpanded with the tx id', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    renderRow({ tx: splitTx, expanded: false, onToggleExpanded: onToggle });
    await user.click(screen.getByRole('button', { name: /Ventilée \(2\)/ }));
    expect(onToggle).toHaveBeenCalledWith(splitTx.id);
  });

  it('renders a nested category as "Parent › Leaf"', async () => {
    renderRow({ tx: txWithCategory(42) });
    expect(await screen.findByText('Courses › Alimentation')).toBeInTheDocument();
  });

  it('renders a root category with just its name', async () => {
    renderRow({ tx: txWithCategory(41) });
    expect(await screen.findByText('Courses')).toBeInTheDocument();
  });
});

describe('TransactionRow running-balance cell', () => {
  const txWithBalance: Transaction = { ...t, runningBalance: '70.00' };

  it('shows the formatted running balance when showBalance is true', () => {
    renderRow({ tx: txWithBalance, showBalance: true });
    // formatAmount emits the FR locale — the digit sequence 70,00 should appear.
    expect(screen.getByText(/70[.,]00/)).toBeInTheDocument();
  });

  it('does not render the running balance when showBalance is false', () => {
    renderRow({ tx: txWithBalance, showBalance: false });
    expect(screen.queryByText(/70[.,]00/)).not.toBeInTheDocument();
  });
});

describe('TransactionRow checkpoint checkbox', () => {
  const txWithBalance: Transaction = { ...t, runningBalance: '70.00' };
  const cpLabel = /valider le solde/i;

  it('shows an unchecked checkbox on the end-of-day row when no checkpoint exists', () => {
    renderRow({ tx: txWithBalance, showBalance: true, isEndOfDay: true });
    const cb = screen.getByRole('checkbox', { name: cpLabel });
    expect(cb).not.toBeChecked();
  });

  it('shows a checked checkbox when a checkpoint exists for the date', () => {
    const checkpoint: BalanceCheckpoint = {
      id: 3, accountId: 1, checkpointDate: '2026-06-15', expectedAmount: '70.00', note: null, createdAt: '2026-06-15T00:00:00Z',
    };
    renderRow({ tx: txWithBalance, showBalance: true, isEndOfDay: true, checkpoint });
    expect(screen.getByRole('checkbox', { name: cpLabel })).toBeChecked();
  });

  it('calls onToggleCheckpoint(tx, true) when ticked', async () => {
    const user = userEvent.setup();
    const { onToggleCheckpoint } = renderRow({ tx: txWithBalance, showBalance: true, isEndOfDay: true });
    await user.click(screen.getByRole('checkbox', { name: cpLabel }));
    expect(onToggleCheckpoint).toHaveBeenCalledWith(txWithBalance, true);
  });

  it('disables the checkbox while its mutation is pending', () => {
    renderRow({ tx: txWithBalance, showBalance: true, isEndOfDay: true, checkpointPending: true });
    expect(screen.getByRole('checkbox', { name: cpLabel })).toBeDisabled();
  });

  it('is absent on a non-end-of-day row', () => {
    renderRow({ tx: txWithBalance, showBalance: true, isEndOfDay: false });
    expect(screen.queryByRole('checkbox', { name: cpLabel })).not.toBeInTheDocument();
  });

  it('is absent when the row has no running balance', () => {
    renderRow({ tx: t, showBalance: true, isEndOfDay: true }); // t has no runningBalance
    expect(screen.queryByRole('checkbox', { name: cpLabel })).not.toBeInTheDocument();
  });
});
