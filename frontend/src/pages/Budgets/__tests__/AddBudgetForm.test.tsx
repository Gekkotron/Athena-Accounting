import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AddBudgetForm } from '../AddBudgetForm';

const cats = [
  { id: 1, name: 'Loisirs',   kind: 'expense' as const, color: null, parentId: null, isDefault: false, isInternalTransfer: false },
  { id: 2, name: 'Transport', kind: 'expense' as const, color: null, parentId: null, isDefault: false, isInternalTransfer: false },
];
const accounts = [
  { id: 10, name: 'Compte A', type: 'checking', currency: 'EUR', openingBalance: '0', openingDate: '2026-01-01' },
];

describe('AddBudgetForm', () => {
  it('renders Mensuel / Annuel period radio and Tous / accounts selector', () => {
    render(<AddBudgetForm
      categories={cats} accounts={accounts} budgets={[]} candidates={[]}
      prefill={null} onSubmit={() => {}} isPending={false}
    />);
    expect(screen.getByLabelText(/Mensuel/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Annuel/)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Tous les comptes' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Compte A' })).toBeInTheDocument();
  });

  it('shows suggested placeholder from candidates for the selected category', () => {
    render(<AddBudgetForm
      categories={cats} accounts={accounts} budgets={[]}
      candidates={[
        { categoryId: 1, name: 'Loisirs',   color: null, parentId: null, average: '84.00' },
        { categoryId: 2, name: 'Transport', color: null, parentId: null, average: '120.00' },
      ]}
      prefill={null} onSubmit={() => {}} isPending={false}
    />);
    // Selecting Loisirs shows ≈ 84,00 €/mois.
    fireEvent.change(screen.getByLabelText(/Catégorie/), { target: { value: '1' } });
    const limit = screen.getByLabelText(/Plafond mensuel/i) as HTMLInputElement;
    expect(limit.placeholder).toMatch(/84,00/);
    expect(limit.placeholder).toMatch(/mois/);
  });

  it('changes the placeholder suffix when period switches to yearly', () => {
    render(<AddBudgetForm
      categories={cats} accounts={accounts} budgets={[]}
      candidates={[{ categoryId: 1, name: 'Loisirs', color: null, parentId: null, average: '84.00' }]}
      prefill={null} onSubmit={() => {}} isPending={false}
    />);
    fireEvent.change(screen.getByLabelText(/Catégorie/), { target: { value: '1' } });
    fireEvent.click(screen.getByLabelText(/Annuel/));
    const limit = screen.getByLabelText(/Plafond/i) as HTMLInputElement;
    expect(limit.placeholder).toMatch(/an/);
  });

  it('prefills categoryId and limit when props.prefill is provided', () => {
    render(<AddBudgetForm
      categories={cats} accounts={accounts} budgets={[]} candidates={[]}
      prefill={{ categoryId: 2, suggested: '120.00' }}
      onSubmit={() => {}} isPending={false}
    />);
    expect((screen.getByLabelText(/Catégorie/) as HTMLSelectElement).value).toBe('2');
    expect((screen.getByLabelText(/Plafond/i) as HTMLInputElement).value).toBe('120.00');
  });

  it('submits with period + accountId + limit', () => {
    const onSubmit = vi.fn();
    render(<AddBudgetForm
      categories={cats} accounts={accounts} budgets={[]} candidates={[]}
      prefill={null} onSubmit={onSubmit} isPending={false}
    />);
    fireEvent.change(screen.getByLabelText(/Catégorie/), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/Plafond/i), { target: { value: '50.00' } });
    fireEvent.click(screen.getByLabelText(/Annuel/));
    fireEvent.change(screen.getByLabelText(/Compte :?/), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: /Ajouter/ }));
    expect(onSubmit).toHaveBeenCalledWith({
      categoryId: 1, monthlyLimit: '50.00', period: 'yearly', accountId: 10,
    });
  });

  it('accepts the French decimal comma in the limit field and submits it canonicalized', () => {
    const onSubmit = vi.fn();
    render(<AddBudgetForm
      categories={cats} accounts={accounts} budgets={[]} candidates={[]}
      prefill={null} onSubmit={onSubmit} isPending={false}
    />);
    fireEvent.change(screen.getByLabelText(/Catégorie/), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/Plafond/i), { target: { value: '50,50' } });
    fireEvent.click(screen.getByRole('button', { name: /Ajouter/ }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ monthlyLimit: '50.50' }),
    );
  });

  it('hides already-budgeted categories from the dropdown', () => {
    render(<AddBudgetForm
      categories={cats} accounts={accounts}
      budgets={[{ id: 99, categoryId: 1, monthlyLimit: '10.00', currency: 'EUR', period: 'monthly', accountId: null }]}
      candidates={[]} prefill={null} onSubmit={() => {}} isPending={false}
    />);
    // 'Loisirs' should NOT appear in the dropdown, 'Transport' should.
    const options = Array.from(screen.getByLabelText(/Catégorie/).querySelectorAll('option')).map((o) => o.textContent);
    expect(options).toContain('Transport');
    expect(options).not.toContain('Loisirs');
  });
});
