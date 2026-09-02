import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HubLayout, type HubTab } from '../HubLayout';

const tabs: HubTab[] = [
  { to: '/hub/a', label: 'Alpha' },
  { to: '/hub/b', label: 'Bravo' },
];

function renderAt(url: string, tabsOverride: HubTab[] = tabs) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/hub" element={<HubLayout title="Hub" tabs={tabsOverride} />}>
            <Route path="a" element={<div>content-a</div>} />
            <Route path="b" element={<div>content-b</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('HubLayout', () => {
  it('renders the title and every tab', () => {
    renderAt('/hub/a');
    expect(screen.getByRole('heading', { name: 'Hub' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Alpha' })).toHaveAttribute('href', '/hub/a');
    expect(screen.getByRole('link', { name: 'Bravo' })).toHaveAttribute('href', '/hub/b');
  });

  it('renders the child route content via Outlet', () => {
    renderAt('/hub/a');
    expect(screen.getByText('content-a')).toBeInTheDocument();
    renderAt('/hub/b');
    expect(screen.getByText('content-b')).toBeInTheDocument();
  });

  it('marks the active tab with aria-current="page"', () => {
    renderAt('/hub/b');
    const alpha = screen.getByRole('link', { name: 'Alpha' });
    const bravo = screen.getByRole('link', { name: 'Bravo' });
    expect(bravo).toHaveAttribute('aria-current', 'page');
    expect(alpha).not.toHaveAttribute('aria-current', 'page');
  });

  it('mirrors the left-nav badge on the matching hub tab', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ groups: [{}, {}, {}, {}] }), { status: 200 }));
    try {
      renderAt('/hub/a', [
        { to: '/hub/a', label: 'Imports' },
        { to: '/data/duplicates', label: 'Doublons' },
      ]);
      await waitFor(() =>
        expect(screen.getByRole('link', { name: /Doublons/ })).toHaveTextContent('4'),
      );
      expect(screen.getByRole('link', { name: 'Imports' })).not.toHaveTextContent(/\d/);
    } finally {
      fetchMock.mockRestore();
    }
  });
});
