import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DndContext } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AccountCard } from '../AccountCard';
import type { Account } from '../../../api/types';
import { pinLocale } from '../../../test/i18n';

// AccountCard uses 'accounts' (card copy), 'common' (Edit tooltip), and —
// since the goals strip was added — 'goals' (empty-state label). Preload
// all three so `useTranslation` never suspends the first render.
pinLocale('accounts', 'goals');

const acc: Account = {
  id: 1, name: 'Test', type: 'checking', currency: 'EUR',
  openingBalance: '100.00', openingDate: '2025-01-01',
  currentBalance: '250.00', displayOrder: 0,
};

const defaultProps = {
  account: acc,
  onEdit: () => {},
  onExpand: () => {},
  expanded: false,
};

function renderCard(props: Partial<typeof defaultProps> = {}) {
  // AccountCard hydrates AccountCardGoals via useQuery — wrap in a fresh
  // QueryClient per test so hooks inside the card have their required
  // provider, and results don't leak across tests.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DndContext>
          <SortableContext items={[acc.id]} strategy={rectSortingStrategy}>
            <AccountCard {...defaultProps} {...props} />
          </SortableContext>
        </DndContext>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AccountCard', () => {
  it('renders name, translated type, currency, and balance', () => {
    renderCard();
    expect(screen.getByText('Test')).toBeInTheDocument();
    // The raw backend value ("checking") is translated for display.
    expect(screen.getByText('Courant')).toBeInTheDocument();
    expect(screen.queryByText(/checking/i)).not.toBeInTheDocument();
    expect(screen.getByText(/EUR/)).toBeInTheDocument();
    expect(screen.getByText(/250/)).toBeInTheDocument();
  });

  it('shows a "dont X bloqués · N ans" line when part of the balance is locked', () => {
    renderCard({
      account: { ...acc, currentBalance: '10000.00', availableBalance: '3000.00', lockYears: 5 },
    });
    expect(screen.getByText(/bloqués/i)).toBeInTheDocument();
    expect(screen.getByText(/5 ans/i)).toBeInTheDocument();
  });

  it('omits the blocked line when nothing is locked', () => {
    renderCard({ account: { ...acc, currentBalance: '250.00', availableBalance: '250.00' } });
    expect(screen.queryByText(/bloqués/i)).not.toBeInTheDocument();
  });

  it('shows a "placé" tag on an investment account with no lock', () => {
    renderCard({
      account: { ...acc, type: 'investment', currentBalance: '250.00', availableBalance: '250.00' },
    });
    // Exact, case-sensitive matches: "Placé" is the translated type label,
    // lowercase "placé" is the invested tag.
    expect(screen.getByText('placé')).toBeInTheDocument();
    expect(screen.getByText('Placé')).toBeInTheDocument();
  });

  it('fires onEdit(account) when modifier is clicked', async () => {
    const onEdit = vi.fn();
    const user = userEvent.setup();
    renderCard({ onEdit });
    await user.click(screen.getByRole('button', { name: /modifier/i }));
    expect(onEdit).toHaveBeenCalledWith(acc);
  });

  it('renders a drag handle for reordering', () => {
    renderCard();
    expect(screen.getByRole('button', { name: /réorganiser/i })).toBeInTheDocument();
  });

  it('fires onExpand when the checkpoints toggle is clicked', async () => {
    const onExpand = vi.fn();
    const user = userEvent.setup();
    renderCard({ onExpand });
    await user.click(screen.getByRole('button', { name: /points de contrôle/i }));
    expect(onExpand).toHaveBeenCalledWith(1);
  });

  it('does not render the drawer when expanded is false', () => {
    renderCard();
    expect(screen.queryByText(/aucun point de contrôle/i)).not.toBeInTheDocument();
  });

  it('links to /transactions?accountId=<id>', () => {
    renderCard();
    const link = screen.getByRole('link', { name: /transactions/i });
    expect(link).toHaveAttribute('href', '/transactions?accountId=1');
  });

  it('shows a "Fermé" badge when closedAt is set', () => {
    renderCard({ account: { ...acc, closedAt: '2026-06-30' } });
    expect(screen.getByText('Fermé')).toBeInTheDocument();
  });

  it('omits the "Fermé" badge when closedAt is null', () => {
    renderCard({ account: { ...acc, closedAt: null } });
    expect(screen.queryByText('Fermé')).not.toBeInTheDocument();
  });

  it('renders the IBAN in 4-char groups when the account has one', () => {
    renderCard({ account: { ...acc, iban: 'FR7612345678901234567890123' } });
    expect(screen.getByText('IBAN')).toBeInTheDocument();
    expect(screen.getByText(/FR76 1234 5678 9012 3456 7890 123/)).toBeInTheDocument();
  });

  it('omits the IBAN block when iban is null', () => {
    renderCard({ account: { ...acc, iban: null } });
    expect(screen.queryByText('IBAN')).not.toBeInTheDocument();
  });

  it('copies the compact uppercase IBAN when the copy button is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    // jsdom's `navigator.clipboard` is a read-only getter → defineProperty.
    // fireEvent (not userEvent.click) because the sibling DnD sensor on the
    // SortableContext swallows the pointer sequence userEvent synthesises.
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    renderCard({ account: { ...acc, iban: 'fr76 1234 5678 9012' } });
    fireEvent.click(screen.getByRole('button', { name: /copier l'iban/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('FR76123456789012'));
  });
});
