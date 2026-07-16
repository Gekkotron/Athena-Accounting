import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Patterns } from '../Patterns';
import i18n from '../../../i18n';

// Patterns renders PatternsSection, which uses the 'accounts' namespace.
// Preload it for both locales, pinned to French, so `useTranslation` never
// suspends and the existing French-literal assertions below keep matching
// real rendered text.
beforeAll(async () => {
  await i18n.changeLanguage('fr');
  await i18n.loadNamespaces(['accounts']);
});

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
