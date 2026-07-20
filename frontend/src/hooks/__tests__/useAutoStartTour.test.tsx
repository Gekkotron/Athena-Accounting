import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TipsProvider } from '../../contexts/TipsContext';
import { TourProvider, useTour } from '../../contexts/TourContext';
import { useAutoStartTour } from '../useAutoStartTour';

type Dismissed = Record<string, string>;
function stubTips(dismissed: Dismissed = {}) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('/api/tips/dismissed')) {
      return { ok: true, status: 200,
        text: async () => JSON.stringify({ dismissed }),
      } as Response;
    }
    return { ok: true, status: 200, text: async () => '{}' } as Response;
  }));
}

function Harness({ pageId, requireData, onTour }: {
  pageId: any; requireData?: () => boolean; onTour: (activePageId: string | null) => void;
}) {
  useAutoStartTour(pageId, requireData ? { requireData } : undefined);
  const tour = useTour();
  onTour(tour.activePageId);
  return null;
}

beforeEach(() => {
  vi.resetAllMocks();
});

function wrap(node: React.ReactNode) {
  return (
    <MemoryRouter>
      <TipsProvider>
        <TourProvider>{node}</TourProvider>
      </TipsProvider>
    </MemoryRouter>
  );
}

describe('useAutoStartTour', () => {
  it('auto-starts when ready + not-dismissed + no requireData', async () => {
    stubTips();
    const seen: (string | null)[] = [];
    render(wrap(<Harness pageId="dashboard" onTour={(a) => seen.push(a)} />));
    await waitFor(() => expect(seen[seen.length - 1]).toBe('dashboard'));
  });

  it('does NOT auto-start when requireData returns false', async () => {
    stubTips();
    const seen: (string | null)[] = [];
    render(wrap(<Harness pageId="dashboard" requireData={() => false}
                          onTour={(a) => seen.push(a)} />));
    // Allow hydration to complete.
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[seen.length - 1]).toBeNull();
  });

  it('auto-starts once requireData flips to true on rerender', async () => {
    stubTips();
    const seen: (string | null)[] = [];
    let flag = false;
    const { rerender } = render(wrap(
      <Harness pageId="transactions" requireData={() => flag}
               onTour={(a) => seen.push(a)} />
    ));
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[seen.length - 1]).toBeNull();
    flag = true;
    rerender(wrap(
      <Harness pageId="transactions" requireData={() => flag}
               onTour={(a) => seen.push(a)} />
    ));
    await waitFor(() => expect(seen[seen.length - 1]).toBe('transactions'));
  });

  it('treats a throwing requireData as false and does not crash', async () => {
    stubTips();
    const seen: (string | null)[] = [];
    render(wrap(
      <Harness pageId="budgets" requireData={() => { throw new Error('boom'); }}
               onTour={(a) => seen.push(a)} />
    ));
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[seen.length - 1]).toBeNull();
  });

  it('does not auto-start when the tour id is already dismissed', async () => {
    stubTips({ 'tour:dashboard': '2026-07-01T00:00:00Z' });
    const seen: (string | null)[] = [];
    render(wrap(<Harness pageId="dashboard" onTour={(a) => seen.push(a)} />));
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[seen.length - 1]).toBeNull();
  });
});
