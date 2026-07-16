import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TipsProvider } from '../../contexts/TipsContext';
import { Settings } from '../Settings';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const confirmSpy = vi.spyOn(window, 'confirm');

beforeEach(() => {
  fetchMock.mockReset();
  confirmSpy.mockReset();
  // api() reads res.text() (not res.json()), so every mocked response needs
  // a text() method. {} satisfies every shape Settings reads through
  // `?? <fallback>` (accounts, settings, mcp, dismissed).
  fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({}) });
});

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TipsProvider>
          <Settings />
        </TipsProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('Settings — tips replay', () => {
  it('shows a "Rejouer la visite guidée" button', async () => {
    render(wrap());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Rejouer la visite guidée/i })).toBeTruthy()
    );
  });

  it('calls /api/tips/reset after confirm', async () => {
    confirmSpy.mockReturnValue(true);
    render(wrap());
    const button = await screen.findByRole('button', { name: /Rejouer la visite guidée/i });
    fireEvent.click(button);
    await waitFor(() => {
      const called = fetchMock.mock.calls.some(
        ([url, opts]) => url === '/api/tips/reset' && opts?.method === 'POST',
      );
      expect(called).toBe(true);
    });
  });

  it('does nothing if the user cancels the confirm', async () => {
    confirmSpy.mockReturnValue(false);
    render(wrap());
    const button = await screen.findByRole('button', { name: /Rejouer la visite guidée/i });
    fireEvent.click(button);
    await new Promise((r) => setTimeout(r, 30));
    const called = fetchMock.mock.calls.some(
      ([url]) => url === '/api/tips/reset',
    );
    expect(called).toBe(false);
  });
});
