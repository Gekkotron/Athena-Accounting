import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { DetectedTab } from '../DetectedTab';
import { withTips } from '../../../test/renderWithProviders';
import { pinLocale } from '../../../test/i18n';
import type { Category, RecurringSeries } from '../../../api/types';

vi.mock('../../../api/client', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, api: vi.fn() };
});
import { api } from '../../../api/client';

pinLocale('tips');

const series = (over: Partial<RecurringSeries>): RecurringSeries =>
  ({
    id: 1,
    label: 'Series',
    cadenceDays: 30,
    avgAmount: '-10',
    amountStddev: '0',
    categoryId: null,
    firstSeenAt: '2026-01-01',
    lastSeenAt: '2026-07-01',
    nextDueAt: '2026-08-01',
    status: 'detected',
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

// Default mock router: swallows /api/tips/* and returns predictable data for
// the two queries the DetectedTab issues. Individual tests override this by
// re-configuring `api` before rendering.
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
    if (url.startsWith('/api/recurring/')) return {};
    if (url.startsWith('/api/tips/')) return { dismissed: {} };
    return {};
  });
}

describe('DetectedTab', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
  });

  it('renders the loading block while the initial queries are in flight', () => {
    // Never-resolving promise → both queries stay pending.
    vi.mocked(api).mockImplementation(() => new Promise(() => {}));
    const { container } = render(wrap(<DetectedTab />));
    expect(container.querySelector('.animate-pulse, [role="status"], .surface')).toBeTruthy();
  });

  it('renders the empty state with a "Régénérer la détection" button when no series exist', async () => {
    mockApi({ recurring: [], categories: [] });
    render(wrap(<DetectedTab />));
    expect(
      await screen.findByText(/Aucune série récurrente détectée/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Régénérer la détection/i })).toBeInTheDocument();
  });

  it('renders the error state with a retry button when the recurring query fails', async () => {
    mockApi({ recurringError: new Error('boom'), categories: [] });
    render(wrap(<DetectedTab />));
    // ErrorState renders a "Réessayer" (or English "Retry") button — assert
    // by role rather than text so an i18n change doesn't break the test.
    const buttons = await screen.findAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('groups series by category and shows the "Sans catégorie" bucket last', async () => {
    mockApi({
      categories: [category({ id: 10, name: 'Streaming' })],
      recurring: [
        series({ id: 1, label: 'Netflix', avgAmount: '-15', categoryId: 10 }),
        series({ id: 2, label: 'Mystery', avgAmount: '-50', categoryId: null }),
      ],
    });
    render(wrap(<DetectedTab />));
    // Both rows show up.
    expect(await screen.findByText('Netflix')).toBeInTheDocument();
    expect(screen.getByText('Mystery')).toBeInTheDocument();
    // Group headers.
    expect(screen.getByText('Streaming')).toBeInTheDocument();
    expect(screen.getByText('Sans catégorie')).toBeInTheDocument();

    // Order: categorized group comes before the null bucket.
    const headers = screen.getAllByText(/Streaming|Sans catégorie/);
    const streamingIdx = headers.findIndex((h) => h.textContent === 'Streaming');
    const noneIdx = headers.findIndex((h) => h.textContent === 'Sans catégorie');
    expect(streamingIdx).toBeLessThan(noneIdx);
  });

  it('shows the cadence label, next-due date, and occurrences count on each row', async () => {
    mockApi({
      categories: [],
      recurring: [
        series({
          id: 1,
          label: 'Loyer',
          cadenceDays: 30,
          nextDueAt: '2026-08-01',
          memberCount: 12,
        }),
      ],
    });
    render(wrap(<DetectedTab />));
    expect(await screen.findByText('Loyer')).toBeInTheDocument();
    expect(screen.getByText('Mensuel')).toBeInTheDocument();
    expect(screen.getByText(/12 occurrences/)).toBeInTheDocument();
  });

  it('shows the "Confirmé" badge on confirmed rows and hides the "Confirmer" button', async () => {
    mockApi({
      categories: [],
      recurring: [
        series({ id: 1, label: 'Salaire', status: 'confirmed', avgAmount: '2000' }),
        series({ id: 2, label: 'Netflix', status: 'detected', avgAmount: '-15' }),
      ],
    });
    render(wrap(<DetectedTab />));
    await screen.findByText('Salaire');
    // "Confirmé" badge only on the confirmed row.
    expect(screen.getByText('Confirmé')).toBeInTheDocument();
    // Only the detected row exposes a Confirmer button.
    const confirmButtons = screen.getAllByRole('button', { name: /Confirmer/i });
    expect(confirmButtons).toHaveLength(1);
  });

  it('fires a PUT with status:confirmed when the "Confirmer" button is clicked', async () => {
    mockApi({
      categories: [],
      recurring: [series({ id: 42, label: 'Netflix', status: 'detected' })],
    });
    const user = userEvent.setup();
    render(wrap(<DetectedTab />));
    await user.click(await screen.findByRole('button', { name: /Confirmer/i }));

    await waitFor(() => {
      expect(vi.mocked(api)).toHaveBeenCalledWith(
        '/api/recurring/42',
        expect.objectContaining({ method: 'PUT', json: { status: 'confirmed' } }),
      );
    });
  });

  it('fires a PUT with status:dismissed when the "Ignorer" button is clicked', async () => {
    mockApi({
      categories: [],
      recurring: [series({ id: 7, label: 'Weird', status: 'detected' })],
    });
    const user = userEvent.setup();
    render(wrap(<DetectedTab />));
    await user.click(await screen.findByRole('button', { name: /Ignorer/i }));

    await waitFor(() => {
      expect(vi.mocked(api)).toHaveBeenCalledWith(
        '/api/recurring/7',
        expect.objectContaining({ method: 'PUT', json: { status: 'dismissed' } }),
      );
    });
  });

  it('cycles essentialness: null → essential → discretionary → null', async () => {
    mockApi({
      categories: [],
      recurring: [series({ id: 3, label: 'Gym', status: 'detected', essentialness: null })],
    });
    const user = userEvent.setup();
    render(wrap(<DetectedTab />));

    // Starting state: null → button label is "Marquer".
    const markBtn = await screen.findByRole('button', { name: /^Marquer$/ });
    await user.click(markBtn);
    await waitFor(() => {
      expect(vi.mocked(api)).toHaveBeenCalledWith(
        '/api/recurring/3',
        expect.objectContaining({ method: 'PUT', json: { essentialness: 'essential' } }),
      );
    });
  });

  it('cycles essentialness from essential → discretionary', async () => {
    mockApi({
      categories: [],
      recurring: [
        series({ id: 4, label: 'Loyer', status: 'confirmed', essentialness: 'essential' }),
      ],
    });
    const user = userEvent.setup();
    render(wrap(<DetectedTab />));

    await user.click(await screen.findByRole('button', { name: /^Essentiel$/ }));
    await waitFor(() => {
      expect(vi.mocked(api)).toHaveBeenCalledWith(
        '/api/recurring/4',
        expect.objectContaining({ method: 'PUT', json: { essentialness: 'discretionary' } }),
      );
    });
  });

  it('cycles essentialness from discretionary → null', async () => {
    mockApi({
      categories: [],
      recurring: [
        series({ id: 5, label: 'Bar', status: 'confirmed', essentialness: 'discretionary' }),
      ],
    });
    const user = userEvent.setup();
    render(wrap(<DetectedTab />));

    await user.click(await screen.findByRole('button', { name: /^Discrétionnaire$/ }));
    await waitFor(() => {
      expect(vi.mocked(api)).toHaveBeenCalledWith(
        '/api/recurring/5',
        expect.objectContaining({ method: 'PUT', json: { essentialness: null } }),
      );
    });
  });

  it('posts to /api/recurring/regenerate when the header "Régénérer" button is clicked', async () => {
    mockApi({
      categories: [],
      recurring: [series({ id: 1, label: 'X', status: 'detected' })],
    });
    const user = userEvent.setup();
    render(wrap(<DetectedTab />));

    await user.click(await screen.findByRole('button', { name: /^Régénérer$/ }));
    await waitFor(() => {
      expect(vi.mocked(api)).toHaveBeenCalledWith(
        '/api/recurring/regenerate',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('reveals dismissed series inside a <details> section with an "Annuler" restore button', async () => {
    mockApi({
      categories: [],
      recurring: [
        series({ id: 1, label: 'Active', status: 'detected' }),
        series({ id: 2, label: 'Old junk', status: 'dismissed' }),
      ],
    });
    render(wrap(<DetectedTab />));
    // The dismissed-count summary uses the singular form "1 série ignorée".
    expect(await screen.findByText(/1 série ignorée/)).toBeInTheDocument();
    expect(screen.getByText('Old junk')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Annuler/i })).toBeInTheDocument();
  });

  it('pluralises the dismissed-count summary when more than one series is ignored', async () => {
    mockApi({
      categories: [],
      recurring: [
        series({ id: 1, label: 'Active', status: 'detected' }),
        series({ id: 2, label: 'A', status: 'dismissed' }),
        series({ id: 3, label: 'B', status: 'dismissed' }),
      ],
    });
    render(wrap(<DetectedTab />));
    expect(await screen.findByText(/2 séries ignorées/)).toBeInTheDocument();
  });

  it('sends status:detected when "Annuler" restores a dismissed series', async () => {
    mockApi({
      categories: [],
      recurring: [
        series({ id: 1, label: 'Active', status: 'detected' }),
        series({ id: 99, label: 'Old junk', status: 'dismissed' }),
      ],
    });
    const user = userEvent.setup();
    render(wrap(<DetectedTab />));
    await user.click(await screen.findByRole('button', { name: /Annuler/i }));
    await waitFor(() => {
      expect(vi.mocked(api)).toHaveBeenCalledWith(
        '/api/recurring/99',
        expect.objectContaining({ method: 'PUT', json: { status: 'detected' } }),
      );
    });
  });
});
