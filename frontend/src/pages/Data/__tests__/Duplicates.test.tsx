import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Duplicates } from '../Duplicates';
import { pinLocale } from '../../../test/i18n';

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: vi.fn().mockResolvedValue({ groups: [] }) };
});

// DuplicatesPanel (rendered by this route) uses useTranslation for the
// 'imports'/'common'/'transactions' namespaces. Preload them for both
// locales so it never suspends mid-render, then pin the active language to
// French so the existing French-literal assertion below keeps matching
// real rendered text.
pinLocale('imports', 'transactions');

describe('Duplicates route', () => {
  it('renders the DuplicatesPanel', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Duplicates />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Possibles doublons')).toBeInTheDocument();
  });
});
