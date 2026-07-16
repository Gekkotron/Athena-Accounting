import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEnvelopeReport } from '../useEnvelopes';

vi.mock('../../api/client', () => ({
  api: vi.fn(),
}));

import { api } from '../../api/client';

function wrap(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useEnvelopeReport', () => {
  beforeEach(() => vi.mocked(api).mockReset());

  it('fetches the report for a given month', async () => {
    vi.mocked(api).mockResolvedValue({ month: '2026-07', pool: { available: '100.00' }, rows: [] });
    const { result } = renderHook(() => useEnvelopeReport('2026-07'), { wrapper: ({ children }) => wrap(children) });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(vi.mocked(api)).toHaveBeenCalledWith('/api/envelopes/report', { query: { month: '2026-07' } });
    expect(result.current.data!.pool.available).toBe('100.00');
  });
});
