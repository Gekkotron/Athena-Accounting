import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DuplicatesPanel } from '../DuplicatesPanel';

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../../api/client';
const apiMock = vi.mocked(api);

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><DuplicatesPanel /></QueryClientProvider>);
}

beforeEach(() => { apiMock.mockReset(); });

describe('DuplicatesPanel', () => {
  it('renders nothing when there are no duplicate groups', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/settings') return {
        settings: {
          dashboardRange: '3m', dashboardChartScope: 'all',
          chartGapThresholdDays: 6, duplicateSimilarityThreshold: 0,
        },
      };
      if (path === '/api/accounts') return { accounts: [] };
      if (path === '/api/transactions/duplicates') return { groups: [] };
      throw new Error(`unexpected: ${path}`);
    });
    const { container } = renderPanel();
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/api/transactions/duplicates'),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one group per cluster with its transactions', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/settings') return {
        settings: {
          dashboardRange: '3m', dashboardChartScope: 'all',
          chartGapThresholdDays: 6, duplicateSimilarityThreshold: 0,
        },
      };
      if (path === '/api/accounts') {
        return {
          accounts: [
            { id: 1, name: 'Compte courant', type: 'checking', currency: 'EUR', openingBalance: '0', openingDate: '2025-01-01' },
          ],
        };
      }
      if (path === '/api/transactions/duplicates') {
        return {
          groups: [
            {
              date: '2026-06-15',
              amount: '-42.30',
              accountId: 1,
              transactions: [
                { id: 100, raw_label: 'CB CARREFOUR', normalized_label: 'carrefour', source_file_id: 1, category_id: null },
                { id: 101, raw_label: 'PAIEMENT CARREFOUR MARKET', normalized_label: 'carrefour market', source_file_id: 2, category_id: null },
              ],
            },
          ],
        };
      }
      throw new Error(`unexpected: ${path}`);
    });
    renderPanel();
    expect(await screen.findByText('CB CARREFOUR')).toBeInTheDocument();
    expect(await screen.findByText('PAIEMENT CARREFOUR MARKET')).toBeInTheDocument();
    expect(screen.getByText('Compte courant')).toBeInTheDocument();
    expect(screen.getByText('2026-06-15')).toBeInTheDocument();
  });

  it('bulk-delete fires POST /api/transactions/delete-bulk with the selected ids', async () => {
    const postCalls: Array<{ path: string; init: any }> = [];
    apiMock.mockImplementation(async (path: string, init?: any) => {
      if (path === '/api/settings') return {
        settings: {
          dashboardRange: '3m', dashboardChartScope: 'all',
          chartGapThresholdDays: 6, duplicateSimilarityThreshold: 0,
        },
      };
      if (path === '/api/accounts') return { accounts: [] };
      if (path === '/api/transactions/duplicates') {
        return {
          groups: [
            {
              date: '2026-06-15', amount: '-1', accountId: 1,
              transactions: [
                { id: 100, raw_label: 'A', normalized_label: 'a', source_file_id: null, category_id: null },
                { id: 101, raw_label: 'B', normalized_label: 'b', source_file_id: null, category_id: null },
              ],
            },
          ],
        };
      }
      if (path === '/api/transactions/delete-bulk') {
        postCalls.push({ path, init });
        return { deleted: 1 };
      }
      throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
    });
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText('A');

    await user.click(screen.getByRole('checkbox', { name: /sélectionner la transaction #100/i }));
    await user.click(screen.getByRole('button', { name: /^supprimer$/i }));

    await waitFor(() => expect(postCalls).toHaveLength(1));
    expect(postCalls[0].init.method).toBe('POST');
    expect(postCalls[0].init.json).toEqual({ ids: [100] });
  });

  it('mark-not-duplicate fires POST /api/transactions/mark-not-duplicate with { ids }', async () => {
    const postCalls: Array<{ path: string; init: any }> = [];
    apiMock.mockImplementation(async (path: string, init?: any) => {
      if (path === '/api/settings') return {
        settings: {
          dashboardRange: '3m', dashboardChartScope: 'all',
          chartGapThresholdDays: 6, duplicateSimilarityThreshold: 0,
        },
      };
      if (path === '/api/accounts') return { accounts: [] };
      if (path === '/api/transactions/duplicates') {
        return {
          groups: [
            {
              date: '2026-06-15',
              amount: '-1',
              accountId: 1,
              transactions: [{ id: 100, raw_label: 'X', normalized_label: 'x', source_file_id: null, category_id: null }],
            },
          ],
        };
      }
      if (path === '/api/transactions/mark-not-duplicate') {
        postCalls.push({ path, init });
        return { updated: 1 };
      }
      throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
    });
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText('X');
    await user.click(screen.getByRole('button', { name: /pas un doublon/i }));
    await waitFor(() => expect(postCalls).toHaveLength(1));
    expect(postCalls[0].init.method).toBe('POST');
    expect(Object.keys(postCalls[0].init.json)).toEqual(['ids']);
    expect(postCalls[0].init.json).toEqual({ ids: [100] });
  });

  it('seeds the similarity threshold from /api/settings', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/settings') return {
        settings: {
          dashboardRange: '3m', dashboardChartScope: 'all',
          chartGapThresholdDays: 6, duplicateSimilarityThreshold: 42,
        },
      };
      if (path === '/api/accounts') return { accounts: [] };
      if (path === '/api/transactions/duplicates') return {
        groups: [
          {
            date: '2026-06-15', amount: '-1', accountId: 1,
            transactions: [
              { id: 100, raw_label: 'A', normalized_label: 'a', source_file_id: null, category_id: null },
              { id: 101, raw_label: 'B', normalized_label: 'b', source_file_id: null, category_id: null },
            ],
          },
        ],
      };
      throw new Error(`unexpected: ${path}`);
    });
    renderPanel();
    // Threshold display "42%" appears once settings resolve.
    expect(await screen.findByText(/42%/)).toBeInTheDocument();
  });
});
