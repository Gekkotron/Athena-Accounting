import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Duplicates } from '../Duplicates';

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: vi.fn().mockResolvedValue({ groups: [] }) };
});

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
