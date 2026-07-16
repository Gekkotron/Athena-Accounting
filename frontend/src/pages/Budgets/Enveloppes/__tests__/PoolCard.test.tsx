import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PoolCard } from '../PoolCard';
import i18n from '../../../../i18n';

beforeAll(async () => {
  await i18n.changeLanguage('fr');
  await i18n.loadNamespaces(['budgets']);
});

const pool = {
  incomeCumulative: '18400.00',
  assignedCumulative: '16900.00',
  heldFromPriorMonths: '500.00',
  heldForNextMonth: '0.00',
  available: '1240.00',
};

describe('PoolCard', () => {
  it('renders the headline available amount', () => {
    render(<PoolCard pool={pool} onHoldClick={vi.fn()} />);
    expect(screen.getByText('1 240,00 €')).toBeInTheDocument();
  });

  it('shows red when available < 0', () => {
    render(<PoolCard pool={{ ...pool, available: '-50.00' }} onHoldClick={vi.fn()} />);
    expect(screen.getByText('−50,00 €')).toHaveClass('text-clay-300');
  });

  it('fires onHoldClick when the Retenir button is pressed', () => {
    const spy = vi.fn();
    render(<PoolCard pool={pool} onHoldClick={spy} />);
    fireEvent.click(screen.getByRole('button', { name: /Retenir/i }));
    expect(spy).toHaveBeenCalled();
  });
});
