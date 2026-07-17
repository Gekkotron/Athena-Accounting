import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InsightsSection } from '../InsightsSection';
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
      <InsightsSection currency={currency} />
    </QueryClientProvider>,
  );
}

// InsightsSection renders French strings by default (the app's current UI
// language). Preload the 'dashboard' namespace for both locales so
// `useTranslation` never suspends mid-render, then pin the active language
// to French so the existing French-literal assertions below keep matching
// real rendered text (per the i18n migration recipe's locale-preserving-
// helper fallback).
pinLocale('dashboard');

beforeEach(async () => {
  apiMock.mockReset();
  // Pin the clock so referenceMonth === '2026-06' deterministically. Fake ONLY
  // Date — leaving setTimeout/setInterval real so Testing Library's findBy/
  // waitFor polling still advances (faking all timers would hang them).
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-07-15T00:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

// Category rows produce a +20% spend rise (June vs May) with steady income, so
// spend-delta is the single notable insight; budget resolves empty.
function mockNotable() {
  apiMock.mockImplementation((path: string) => {
    if (path.includes('budget')) return Promise.resolve({ month: '2026-06', rows: [], totals: { limit: '0', spent: '0' } });
    return Promise.resolve({
      rows: [
        { category_id: 1, category_name: 'Courses', category_kind: null, category_is_internal_transfer: false, month: '2026-05', total: '-1000.00', transaction_count: 1 },
        { category_id: 1, category_name: 'Courses', category_kind: null, category_is_internal_transfer: false, month: '2026-06', total: '-1200.00', transaction_count: 1 },
        { category_id: 2, category_name: 'Salaire', category_kind: 'income', category_is_internal_transfer: false, month: '2026-05', total: '3000.00', transaction_count: 1 },
        { category_id: 2, category_name: 'Salaire', category_kind: 'income', category_is_internal_transfer: false, month: '2026-06', total: '3000.00', transaction_count: 1 },
      ],
    });
  });
}

describe('InsightsSection', () => {
  it('renders the reference month in the header', async () => {
    mockNotable();
    renderWithProviders();
    // Target the header subtitle specifically ("— juin"); "juin" also appears
    // inside insight headlines, so match the em-dash-prefixed header text.
    expect(await screen.findByText(/—\s*juin/i)).toBeInTheDocument();
  });

  it('renders a notable insight row', async () => {
    mockNotable();
    renderWithProviders();
    expect(await screen.findByText(/Vos dépenses de juin/i)).toBeInTheDocument();
    expect(screen.getByText(/\+20,0 %/)).toBeInTheDocument();
  });

  it('shows the empty state when no insight clears a threshold', async () => {
    apiMock.mockImplementation((path: string) => {
      if (path.includes('budget')) return Promise.resolve({ month: '2026-06', rows: [], totals: { limit: '0', spent: '0' } });
      return Promise.resolve({ rows: [] });
    });
    renderWithProviders();
    expect(await screen.findByText(/Rien de notable/i)).toBeInTheDocument();
  });

  it('steps to the previous complete month via the arrow', async () => {
    apiMock.mockImplementation((path: string) => {
      if (path.includes('budget')) return Promise.resolve({ month: '', rows: [], totals: { limit: '0', spent: '0' } });
      // Spend across three complete months so May-vs-April is a notable rise.
      return Promise.resolve({
        rows: [
          { category_id: 1, category_name: 'Courses', category_kind: null, category_is_internal_transfer: false, month: '2026-04', total: '-1000.00', transaction_count: 1 },
          { category_id: 1, category_name: 'Courses', category_kind: null, category_is_internal_transfer: false, month: '2026-05', total: '-1300.00', transaction_count: 1 },
          { category_id: 1, category_name: 'Courses', category_kind: null, category_is_internal_transfer: false, month: '2026-06', total: '-1200.00', transaction_count: 1 },
        ],
      });
    });
    renderWithProviders();
    expect(await screen.findByText(/— juin 2026/i)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Mois précédent'));
    expect(await screen.findByText(/— mai 2026/i)).toBeInTheDocument();
    expect(await screen.findByText(/Vos dépenses de mai/i)).toBeInTheDocument();
  });

  it('still renders money insights when the budget query fails', async () => {
    apiMock.mockImplementation((path: string) => {
      if (path.includes('budget')) return Promise.reject(new Error('boom'));
      return Promise.resolve({
        rows: [
          { category_id: 1, category_name: 'Courses', category_kind: null, category_is_internal_transfer: false, month: '2026-05', total: '-1000.00', transaction_count: 1 },
          { category_id: 1, category_name: 'Courses', category_kind: null, category_is_internal_transfer: false, month: '2026-06', total: '-1200.00', transaction_count: 1 },
        ],
      });
    });
    renderWithProviders();
    expect(await screen.findByText(/Vos dépenses de juin/i)).toBeInTheDocument();
  });
});
