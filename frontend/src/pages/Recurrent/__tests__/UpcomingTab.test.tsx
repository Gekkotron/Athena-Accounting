import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { UpcomingTab } from '../UpcomingTab';
import { withTips } from '../../../test/renderWithProviders';
import { pinLocale } from '../../../test/i18n';
import type { Category, RecurringSeries } from '../../../api/types';

vi.mock('../../../api/client', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, api: vi.fn() };
});
import { api } from '../../../api/client';

pinLocale('tips');

// Test doubles refer to "today" as a fixed date so the derived
// lastSeenAt / nextDueAt strings are stable independent of the wall clock.
// The tab itself computes its own todayIso() at runtime — so lateness is
// derived from the real current date. To keep tests deterministic we
// carefully pick lastSeenAt values relative to the *actual* today,
// exposed via `wallToday` below.
function todayIsoUtc(): string {
  const d = new Date();
  const pad = (n: number) => (n < 10 ? '0' + n : String(n));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function isoDaysFromToday(days: number): string {
  const now = new Date();
  const t = now.getTime() + days * 86_400_000;
  const d = new Date(t);
  const pad = (n: number) => (n < 10 ? '0' + n : String(n));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

const series = (over: Partial<RecurringSeries>): RecurringSeries =>
  ({
    id: 1,
    label: 'Series',
    cadenceDays: 30,
    avgAmount: '-15',
    amountStddev: '0',
    categoryId: null,
    firstSeenAt: '2026-01-01',
    lastSeenAt: '2026-07-01',
    nextDueAt: todayIsoUtc(),
    status: 'confirmed',
    essentialness: null,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    memberCount: 4,
    primaryAccountId: null,
    ...over,
  } as RecurringSeries);

const category = (over: Partial<Category>): Category => ({
  id: 1,
  name: 'Catégorie',
  kind: 'expense',
  color: null,
  parentId: null,
  isDefault: false,
  isInternalTransfer: false,
  ...over,
});

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{withTips(<>{children}</>)}</MemoryRouter>
    </QueryClientProvider>
  );
}

function mockApi(routes: {
  recurring?: RecurringSeries[];
  categories?: Category[];
  recurringError?: Error;
}) {
  vi.mocked(api).mockImplementation(async (url: string) => {
    if (url === '/api/recurring') {
      if (routes.recurringError) throw routes.recurringError;
      return { recurring: routes.recurring ?? [] };
    }
    if (url === '/api/categories') return { categories: routes.categories ?? [] };
    if (url.startsWith('/api/tips/')) return { dismissed: {} };
    return {};
  });
}

describe('UpcomingTab', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
  });

  it('renders the empty state with a "Détectés" link when no series are due', async () => {
    mockApi({ recurring: [], categories: [] });
    render(wrap(<UpcomingTab />));
    expect(
      await screen.findByText(/Aucune échéance récurrente prévue/i),
    ).toBeInTheDocument();
    // Empty-state hint links back to the Détectés tab.
    expect(screen.getByRole('link', { name: /Détectés/i })).toBeInTheDocument();
  });

  it('drops dismissed series entirely, even if they had an upcoming nextDueAt', async () => {
    mockApi({
      recurring: [series({ id: 1, label: 'Old', status: 'dismissed' })],
      categories: [],
    });
    render(wrap(<UpcomingTab />));
    expect(
      await screen.findByText(/Aucune échéance récurrente prévue/i),
    ).toBeInTheDocument();
    expect(screen.queryByText('Old')).not.toBeInTheDocument();
  });

  it('renders a section per due-day with the "Aujourd\'hui" header for series due today', async () => {
    mockApi({
      recurring: [
        series({
          id: 1,
          label: 'Netflix',
          cadenceDays: 30,
          // lastSeenAt exactly one cadence ago → expected == today,
          // daysLate == 0, so it falls in the future bucket for today.
          lastSeenAt: isoDaysFromToday(-30),
          nextDueAt: todayIsoUtc(),
        }),
      ],
      categories: [],
    });
    render(wrap(<UpcomingTab />));
    expect(await screen.findByText(/Aujourd'hui/)).toBeInTheDocument();
    expect(screen.getByText('Netflix')).toBeInTheDocument();
  });

  it('renders the "Demain" header for series due tomorrow', async () => {
    mockApi({
      recurring: [
        series({
          id: 1,
          label: 'Spotify',
          cadenceDays: 30,
          lastSeenAt: isoDaysFromToday(-29),
          nextDueAt: isoDaysFromToday(1),
        }),
      ],
      categories: [],
    });
    render(wrap(<UpcomingTab />));
    expect(await screen.findByText('Demain')).toBeInTheDocument();
    expect(screen.getByText('Spotify')).toBeInTheDocument();
  });

  it('surfaces a series past its tolerance as "En retard" with a "Retard : N jours" badge', async () => {
    mockApi({
      recurring: [
        series({
          id: 1,
          label: 'Loyer',
          cadenceDays: 30,
          // Expected 10 days ago → daysLate = 10, tolerance = 0.2 * 30 = 6.
          // 10 > 6 → falls in the late bucket.
          lastSeenAt: isoDaysFromToday(-40),
          nextDueAt: todayIsoUtc(),
        }),
      ],
      categories: [],
    });
    render(wrap(<UpcomingTab />));
    expect(await screen.findByText('En retard')).toBeInTheDocument();
    expect(screen.getByText('Loyer')).toBeInTheDocument();
    expect(screen.getByText(/Retard : 10 jours/)).toBeInTheDocument();
  });

  it('shows the "Confirmé" pill for confirmed series and "Détecté" for detected', async () => {
    mockApi({
      recurring: [
        series({
          id: 1,
          label: 'Salaire',
          status: 'confirmed',
          avgAmount: '2000',
          lastSeenAt: isoDaysFromToday(-30),
          nextDueAt: todayIsoUtc(),
        }),
        series({
          id: 2,
          label: 'Random',
          status: 'detected',
          lastSeenAt: isoDaysFromToday(-30),
          nextDueAt: todayIsoUtc(),
        }),
      ],
      categories: [],
    });
    render(wrap(<UpcomingTab />));
    await screen.findByText('Salaire');
    expect(screen.getByText('Confirmé')).toBeInTheDocument();
    expect(screen.getByText('Détecté')).toBeInTheDocument();
  });

  it('shows an "Essentiel" pill for series flagged essential', async () => {
    mockApi({
      recurring: [
        series({
          id: 1,
          label: 'Loyer',
          essentialness: 'essential',
          lastSeenAt: isoDaysFromToday(-30),
          nextDueAt: todayIsoUtc(),
        }),
      ],
      categories: [],
    });
    render(wrap(<UpcomingTab />));
    expect(await screen.findByText('Essentiel')).toBeInTheDocument();
  });

  it('renders the category dot + name when the series has a resolved category', async () => {
    mockApi({
      recurring: [
        series({
          id: 1,
          label: 'Loyer',
          categoryId: 42,
          lastSeenAt: isoDaysFromToday(-30),
          nextDueAt: todayIsoUtc(),
        }),
      ],
      categories: [category({ id: 42, name: 'Logement' })],
    });
    render(wrap(<UpcomingTab />));
    await screen.findByText('Loyer');
    expect(screen.getByText('Logement')).toBeInTheDocument();
  });
});
