import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ConsolidatedTotalCard, type ConsolidatedBlock } from '../ConsolidatedTotalCard';
import { pinLocale } from '../../../test/i18n';

pinLocale();

function renderCard(consolidated: ConsolidatedBlock | null, currencyCount: number) {
  return render(
    <MemoryRouter>
      <ConsolidatedTotalCard consolidated={consolidated} currencyCount={currencyCount} />
    </MemoryRouter>,
  );
}

describe('ConsolidatedTotalCard', () => {
  it('renders one big total and no warning strip when every currency is mapped', () => {
    const consolidated: ConsolidatedBlock = {
      display: 'EUR',
      total: '190.00',
      available: '190.00',
      invested: '0.00',
      unmapped: [],
    };
    renderCard(consolidated, 2);
    expect(screen.getByText(/190,00/)).toBeInTheDocument();
    expect(screen.getByText(/Convertie depuis 2 devises/)).toBeInTheDocument();
    expect(screen.queryByText('Devises non converties — ajoutez un taux pour les inclure dans le total :')).not.toBeInTheDocument();
  });

  it('renders a warning strip listing unmapped currencies, total reflecting only mapped rows', () => {
    const consolidated: ConsolidatedBlock = {
      display: 'EUR',
      total: '140.00',
      available: '140.00',
      invested: '0.00',
      unmapped: [{ currency: 'USD', total: '50.00', available: '50.00', invested: '0.00', account_count: 1 }],
    };
    renderCard(consolidated, 2);
    expect(screen.getByText(/140,00/)).toBeInTheDocument();
    expect(screen.getByText('Devises non converties — ajoutez un taux pour les inclure dans le total :')).toBeInTheDocument();
    expect(screen.getByText('USD')).toBeInTheDocument();
    expect(screen.getAllByText('Ajouter un taux').length).toBeGreaterThan(0);
  });

  it('renders nothing when consolidated is null', () => {
    const { container } = renderCard(null, 1);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when only one currency is in the pot — no real consolidation, DashboardHero already shows that amount', () => {
    const consolidated: ConsolidatedBlock = {
      display: 'EUR',
      total: '190.00',
      available: '190.00',
      invested: '0.00',
      unmapped: [],
    };
    const { container } = renderCard(consolidated, 1);
    expect(container).toBeEmptyDOMElement();
  });

  it('hides the chip when a second currency is unmapped (mapped count drops to 1)', () => {
    const consolidated: ConsolidatedBlock = {
      display: 'EUR',
      total: '140.00',
      available: '140.00',
      invested: '0.00',
      unmapped: [{ currency: 'USD', total: '50.00', available: '50.00', invested: '0.00', account_count: 1 }],
    };
    renderCard(consolidated, 2);
    expect(screen.queryByText(/Convertie depuis/)).not.toBeInTheDocument();
    expect(screen.getByText('USD')).toBeInTheDocument();
  });
});
