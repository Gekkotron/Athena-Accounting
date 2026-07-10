import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DndContext } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import { AccountCard } from '../AccountCard';
import type { Account } from '../../../api/types';

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
  return render(
    <DndContext>
      <SortableContext items={[acc.id]} strategy={rectSortingStrategy}>
        <AccountCard {...defaultProps} {...props} />
      </SortableContext>
    </DndContext>,
  );
}

describe('AccountCard', () => {
  it('renders name, type, currency, and balance', () => {
    renderCard();
    expect(screen.getByText('Test')).toBeInTheDocument();
    expect(screen.getByText(/checking/i)).toBeInTheDocument();
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
    expect(screen.getByText(/placé/i)).toBeInTheDocument();
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
});
