import { describe, it, expect, vi, beforeAll } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { UnbudgetedSection } from '../UnbudgetedSection';
import i18n from '../../../i18n';

beforeAll(async () => {
  await i18n.changeLanguage('fr');
  await i18n.loadNamespaces(['budgets']);
});

const candidates = [
  { categoryId: 1, name: 'Loisirs', color: null, parentId: null, average: '84.00' },
  { categoryId: 2, name: 'Transport', color: null, parentId: null, average: '120.00' },
];

describe('UnbudgetedSection', () => {
  it('returns null when no candidates', () => {
    const { container } = render(
      <UnbudgetedSection candidates={[]} period="monthly" onDefineBudget={() => {}} />,
    );
    expect(container.textContent).toBe('');
  });

  it('renders count in French with the correct period unit', () => {
    render(<UnbudgetedSection candidates={candidates} period="monthly" onDefineBudget={() => {}} />);
    expect(screen.getByText(/Catégories sans budget \(2\)/)).toBeInTheDocument();
    // Collapsed by default — click header to expand.
    fireEvent.click(screen.getByText(/Catégories sans budget/));
    expect(screen.getByText(/84,00 €\/mois/)).toBeInTheDocument();
    expect(screen.getByText(/120,00 €\/mois/)).toBeInTheDocument();
  });

  it('uses "/an" suffix in yearly view', () => {
    render(<UnbudgetedSection candidates={candidates} period="yearly" onDefineBudget={() => {}} />);
    fireEvent.click(screen.getByText(/Catégories sans budget/));
    expect(screen.getByText(/84,00 €\/an/)).toBeInTheDocument();
  });

  it('calls onDefineBudget with categoryId + average on click', () => {
    const onDefineBudget = vi.fn();
    render(<UnbudgetedSection candidates={candidates} period="monthly" onDefineBudget={onDefineBudget} />);
    fireEvent.click(screen.getByText(/Catégories sans budget/));
    fireEvent.click(screen.getAllByRole('button', { name: /Définir un plafond/ })[0]!);
    expect(onDefineBudget).toHaveBeenCalledWith(1, '84.00');
  });
});
