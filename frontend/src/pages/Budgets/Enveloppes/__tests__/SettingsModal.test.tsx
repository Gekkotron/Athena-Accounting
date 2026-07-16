import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsModal } from '../SettingsModal';
import i18n from '../../../../i18n';

beforeAll(async () => {
  await i18n.changeLanguage('fr');
  await i18n.loadNamespaces(['budgets', 'common']);
});

const row = {
  categoryId: 1, categoryName: 'Vacances', target: null,
  overspendPolicy: 'rollover_negative' as const,
} as any;

describe('SettingsModal', () => {
  it('saves save_by_date target with amount and date', () => {
    const spy = vi.fn();
    render(<SettingsModal open row={row} onClose={vi.fn()} onSave={spy} />);
    fireEvent.change(screen.getByLabelText(/Objectif/i), { target: { value: 'save_by_date' } });
    fireEvent.change(screen.getByLabelText(/Montant/i), { target: { value: '1200,00' } });
    fireEvent.change(screen.getByLabelText(/Échéance/i), { target: { value: '2026-12-01' } });
    fireEvent.click(screen.getByLabelText(/Réaffectation manuelle/i));
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer/i }));
    expect(spy).toHaveBeenCalledWith({
      categoryId: 1,
      body: {
        targetAmount: '1200.00', targetDate: '2026-12-01',
        targetKind: 'save_by_date', overspendPolicy: 'reallocate_manual',
      },
    });
  });

  it('deletes target when the delete button is clicked, preserving overspend policy', () => {
    const rowWithTarget = { ...row, target: { amount: '500.00', date: null, kind: 'monthly_recurring' } };
    const spy = vi.fn();
    render(<SettingsModal open row={rowWithTarget} onClose={vi.fn()} onSave={spy} />);
    fireEvent.click(screen.getByRole('button', { name: /Supprimer l'objectif/i }));
    expect(spy).toHaveBeenCalledWith({
      categoryId: 1,
      body: {
        targetAmount: null, targetDate: null, targetKind: null,
        overspendPolicy: 'rollover_negative',
      },
    });
  });
});
