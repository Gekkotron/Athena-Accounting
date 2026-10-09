import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DashboardHero } from '../DashboardHero';
import { pinLocale } from '../../../test/i18n';

pinLocale('dashboard');

it('shows just the headline + sum line when nothing is blocked or invested', () => {
  render(
    <DashboardHero
      primary={{
        currency: 'EUR',
        total: '1000',
        available: '1000',
        invested: '0',
        account_count: 2,
      }}
    />,
  );
  expect(screen.getByText('Solde net')).toBeInTheDocument();
  // No breakdown grid — the four mini-tile labels should be absent.
  expect(screen.queryByText('Total')).toBeNull();
  expect(screen.queryByText('Placé')).toBeNull();
  expect(screen.queryByText('Bloqué')).toBeNull();
  // The small "Disponible" tile label uses the same string as the headline
  // switch; here the headline is "Solde net" so the tile should also be absent.
  expect(screen.queryByText('Disponible')).toBeNull();
});

it('switches headline to Disponible and shows the Total + Bloqué + Disponible tiles when a locked sub-pot exists', () => {
  render(
    <DashboardHero
      primary={{
        currency: 'EUR',
        total: '1500',
        available: '1000',
        invested: '0',
        account_count: 3,
      }}
    />,
  );
  // Both the headline label and the mini-grid Disponible tile render the
  // same string — hence getAllByText.
  expect(screen.getAllByText('Disponible').length).toBe(2);
  // Mini-grid tiles — Placé stays hidden because invested = 0.
  expect(screen.getByText('Total')).toBeInTheDocument();
  expect(screen.getByText('Bloqué')).toBeInTheDocument();
  expect(screen.queryByText('Placé')).toBeNull();
});

it('shows all four mini-tiles when both blocked AND invested exist', () => {
  render(
    <DashboardHero
      primary={{
        currency: 'EUR',
        total: '2000',
        available: '1500',   // 500 blocked
        invested: '400',     // of the available
        account_count: 4,
      }}
    />,
  );
  expect(screen.getByText('Total')).toBeInTheDocument();
  expect(screen.getByText('Placé')).toBeInTheDocument();
  expect(screen.getByText('Bloqué')).toBeInTheDocument();
  // The tile Disponible appears alongside the headline label of the same
  // name — both reach the DOM, so getAllByText finds two.
  expect(screen.getAllByText('Disponible').length).toBeGreaterThanOrEqual(2);
});

it('renders a placeholder dash when primary is undefined', () => {
  render(<DashboardHero />);
  expect(screen.getByText('Solde net')).toBeInTheDocument();
  expect(screen.getByText('—')).toBeInTheDocument();
});
