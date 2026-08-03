import { it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CategoryBreakdown } from '../CategoryBreakdown';
import { fromDateFor, toDateFor } from '../RangePicker';
import { pinLocale } from '../../test/i18n';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../api/client';
const apiMock = vi.mocked(api);

pinLocale('charts');

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/categories') return { categories: [] } as any;
    return { rows: [] } as any;
  });
});

function renderBreakdown(range: '6m' | '30d') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CategoryBreakdown range={range} onRangeChange={() => {}} />
    </QueryClientProvider>,
  );
}

it('bounds the report window with both fromDate and toDate for month ranges', async () => {
  renderBreakdown('6m');
  await waitFor(() => {
    const call = apiMock.mock.calls.find(([p]) => p === '/api/reports/categories');
    expect(call).toBeDefined();
    expect(call![1]?.query).toMatchObject({
      fromDate: fromDateFor('6m'),
      toDate: toDateFor('6m'),
    });
  });
});

it('sends no toDate for the trailing 30-day range', async () => {
  renderBreakdown('30d');
  await waitFor(() => {
    const call = apiMock.mock.calls.find(([p]) => p === '/api/reports/categories');
    expect(call).toBeDefined();
    expect(call![1]?.query).toMatchObject({ fromDate: fromDateFor('30d') });
    expect(call![1]?.query).not.toHaveProperty('toDate');
  });
});
