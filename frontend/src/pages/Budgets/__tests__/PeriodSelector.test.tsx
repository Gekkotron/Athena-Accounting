import { describe, it, expect, vi, beforeAll } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PeriodSelector } from '../PeriodSelector';
import i18n from '../../../i18n';

beforeAll(async () => {
  await i18n.changeLanguage('fr');
  await i18n.loadNamespaces(['budgets']);
});

describe('PeriodSelector', () => {
  it('renders Mois / Année tabs and the current period label', () => {
    render(<PeriodSelector period="monthly" monthOrYear="2026-07" onChange={() => {}} />);
    // Both tabs carry an explicit aria-label ("Vue mensuelle" / "Vue
    // annuelle") so a plain /Mois/i or /Année/i role query wouldn't
    // unambiguously target the tab (it could also match the period arrows) —
    // query by the exact accessible name instead.
    expect(screen.getByRole('button', { name: 'Vue mensuelle' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vue annuelle' })).toBeInTheDocument();
    expect(screen.getByText('2026-07')).toBeInTheDocument();
  });

  it('emits monthly ↔ yearly with a sensible default value on toggle', () => {
    const onChange = vi.fn();
    render(<PeriodSelector period="monthly" monthOrYear="2026-07" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Vue annuelle' }));
    expect(onChange).toHaveBeenCalledWith({ period: 'yearly', monthOrYear: '2026' });
  });

  it('shifts the current period one step backward on ‹', () => {
    const onChange = vi.fn();
    render(<PeriodSelector period="monthly" monthOrYear="2026-07" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Mois précédent/i }));
    expect(onChange).toHaveBeenCalledWith({ period: 'monthly', monthOrYear: '2026-06' });
  });

  it('shifts the current period one step forward on ›', () => {
    const onChange = vi.fn();
    render(<PeriodSelector period="yearly" monthOrYear="2026" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /^Suivant$/i }));
    expect(onChange).toHaveBeenCalledWith({ period: 'yearly', monthOrYear: '2027' });
  });
});
