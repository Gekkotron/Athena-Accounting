import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  onMoveUp: () => {},
  onMoveDown: () => {},
  canMoveUp: true,
  canMoveDown: true,
  moving: false,
};

describe('AccountCard', () => {
  it('renders name, type, currency, and balance', () => {
    render(<AccountCard {...defaultProps} />);
    expect(screen.getByText('Test')).toBeInTheDocument();
    expect(screen.getByText(/checking/i)).toBeInTheDocument();
    expect(screen.getByText(/EUR/)).toBeInTheDocument();
    expect(screen.getByText(/250/)).toBeInTheDocument();
  });

  it('fires onEdit(account) when modifier is clicked', async () => {
    const onEdit = vi.fn();
    const user = userEvent.setup();
    render(<AccountCard {...defaultProps} onEdit={onEdit} />);
    await user.click(screen.getByRole('button', { name: /modifier/i }));
    expect(onEdit).toHaveBeenCalledWith(acc);
  });

  it('fires onMoveUp / onMoveDown when the reorder buttons are clicked', async () => {
    const onMoveUp = vi.fn();
    const onMoveDown = vi.fn();
    const user = userEvent.setup();
    render(<AccountCard {...defaultProps} onMoveUp={onMoveUp} onMoveDown={onMoveDown} />);
    await user.click(screen.getByRole('button', { name: /déplacer vers le haut/i }));
    await user.click(screen.getByRole('button', { name: /déplacer vers le bas/i }));
    expect(onMoveUp).toHaveBeenCalledTimes(1);
    expect(onMoveDown).toHaveBeenCalledTimes(1);
  });

  it('disables the reorder buttons when at the edges or moving', () => {
    const { rerender } = render(<AccountCard {...defaultProps} canMoveUp={false} />);
    expect(screen.getByRole('button', { name: /déplacer vers le haut/i })).toBeDisabled();
    rerender(<AccountCard {...defaultProps} canMoveDown={false} />);
    expect(screen.getByRole('button', { name: /déplacer vers le bas/i })).toBeDisabled();
    rerender(<AccountCard {...defaultProps} moving={true} />);
    expect(screen.getByRole('button', { name: /déplacer vers le haut/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /déplacer vers le bas/i })).toBeDisabled();
  });

  it('fires onExpand when the checkpoints toggle is clicked', async () => {
    const onExpand = vi.fn();
    const user = userEvent.setup();
    render(<AccountCard {...defaultProps} onExpand={onExpand} />);
    await user.click(screen.getByRole('button', { name: /points de contrôle/i }));
    expect(onExpand).toHaveBeenCalledWith(1);
  });

  it('does not render the drawer when expanded is false', () => {
    render(<AccountCard {...defaultProps} />);
    // Drawer's empty-state text should be absent when collapsed. This is a
    // negative assertion — testing the positive case (drawer mounts on
    // expanded=true) is covered by the drawer's own unit tests in Task 10,
    // where the required QueryClient wrapper is set up.
    expect(screen.queryByText(/aucun point de contrôle/i)).not.toBeInTheDocument();
  });
});
