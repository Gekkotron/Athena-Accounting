import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MoyennesMensuellesSection } from '../MoyennesMensuellesSection';
import { pinLocale } from '../../../test/i18n';

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: vi.fn() };
});

import { api } from '../../../api/client';
const apiMock = vi.mocked(api);

function renderWithProviders(currency = 'EUR') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MoyennesMensuellesSection currency={currency} />
    </QueryClientProvider>,
  );
}

// MoyennesMensuellesSection renders French strings by default (the app's
// current UI language). Preload the 'dashboard' namespace for both locales
// so `useTranslation` never suspends mid-render, then pin the active
// language to French so the existing French-literal assertions below keep
// matching real rendered text (per the i18n migration recipe's
// locale-preserving-helper fallback).
pinLocale('dashboard');

beforeEach(async () => {
  apiMock.mockReset();
});

describe('MoyennesMensuellesSection', () => {
  it('renders the empty-state card when the query returns zero rows', async () => {
    apiMock.mockResolvedValue({ rows: [] });
    renderWithProviders();
    expect(await screen.findByText(/pas encore d'historique/i)).toBeInTheDocument();
    expect(screen.getByText(/Importez au moins un mois complet/i)).toBeInTheDocument();
  });

  it('renders the three stat widgets when history is available', async () => {
    apiMock.mockResolvedValue({
      rows: [
        // 2 distinct months. Mixed negative (spend) and positive (income).
        { month: '2025-03-01', category_id: 1, total: '-200.00' },
        { month: '2025-03-01', category_id: 2, total: '150.00' },
        { month: '2025-04-01', category_id: 1, total: '-400.00' },
        { month: '2025-04-01', category_id: 2, total: '250.00' },
      ],
    });
    renderWithProviders();
    expect(await screen.findByText('Dépense moyenne mensuelle')).toBeInTheDocument();
    expect(screen.getByText('Revenu moyen mensuel')).toBeInTheDocument();
    expect(screen.getByText('Épargne moyenne mensuelle')).toBeInTheDocument();
    // 2-month label
    expect(screen.getByText(/sur 2 mois glissants/)).toBeInTheDocument();
  });

  it('buckets rows into spend/income by SIGN, not by category kind', async () => {
    // Only "neutral" or uncategorized rows in the payload. Old aggregation
    // dropped these because it filtered on category_kind — the sign-based
    // bucketing must still classify them.
    apiMock.mockResolvedValue({
      rows: [
        { month: '2025-03-01', category_id: null, total: '-300.00' }, // uncat spend
        { month: '2025-03-01', category_id: null, total: '500.00' },  // uncat income
      ],
    });
    renderWithProviders();
    // Both widgets should reflect the non-zero average, which formats with
    // a euro symbol. The exact string depends on locale nbsp handling —
    // assert on the presence of the digit sequences.
    expect(await screen.findByText(/300/)).toBeInTheDocument();
    expect(screen.getByText(/500/)).toBeInTheDocument();
  });

  it('renders the singular "mois glissant" label when the window is exactly one month', async () => {
    apiMock.mockResolvedValue({
      rows: [
        { month: '2025-03-01', category_id: 1, total: '-100.00' },
      ],
    });
    renderWithProviders();
    // No trailing "s" in glissant, since monthCount === 1.
    expect(await screen.findByText(/sur 1 mois glissant\b/)).toBeInTheDocument();
  });
});
