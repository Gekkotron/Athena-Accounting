import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Patterns } from '../Patterns';

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../../api/client';
const apiMock = vi.mocked(api);

beforeEach(() => {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/accounts') return { accounts: [] };
    if (path === '/api/account-filename-patterns') return { patterns: [] };
    throw new Error(`unexpected: ${path}`);
  });
});

describe('Patterns route', () => {
  it('renders the PatternsSection headline', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Patterns />
      </QueryClientProvider>,
    );
    // PatternsSection's own headline copy ("Fichier → compte").
    expect(await screen.findByText('Fichier → compte')).toBeInTheDocument();
  });
});
