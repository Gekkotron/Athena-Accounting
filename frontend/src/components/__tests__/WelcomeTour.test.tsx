import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { TipsProvider } from '../../contexts/TipsContext';
import { WelcomeTour } from '../WelcomeTour';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TipsProvider>
        <Routes>
          <Route path="/" element={<WelcomeTour />} />
          <Route path="*" element={<WelcomeTour />} />
        </Routes>
      </TipsProvider>
    </MemoryRouter>,
  );
}

describe('<WelcomeTour />', () => {
  it('renders nothing while TipsContext is not ready', () => {
    fetchMock.mockImplementation(() => new Promise(() => {})); // never resolves
    renderAt('/');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders on `/` when welcome_tour is not dismissed', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, text: async () => JSON.stringify({ dismissed: {} }),
    });
    renderAt('/');
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    expect(screen.getByText(/Bienvenue dans Athena/)).toBeTruthy();
  });

  it('does not render on non-root routes even if not dismissed', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, text: async () => JSON.stringify({ dismissed: {} }),
    });
    renderAt('/transactions');
    // Give hydration a beat.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not render when welcome_tour is already dismissed', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, text: async () => JSON.stringify({ dismissed: { welcome_tour: 'x' } }),
    });
    renderAt('/');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('clicking Terminer on the last step dismisses welcome_tour', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ dismissed: {} }) })
      .mockResolvedValueOnce({ ok: true, status: 204, text: async () => '' });
    renderAt('/');
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    // Advance to the last step
    // (WELCOME_STEPS has 4 steps, so click Suivant 3 times).
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByRole('button', { name: /Suivant/ }));
    }
    fireEvent.click(screen.getByRole('button', { name: /Terminer/ }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/tips/dismiss',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('clicking Passer dismisses welcome_tour', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ dismissed: {} }) })
      .mockResolvedValueOnce({ ok: true, status: 204, text: async () => '' });
    renderAt('/');
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Passer/ }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/tips/dismiss',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('Tab from the last focusable element wraps focus to the first', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, text: async () => JSON.stringify({ dismissed: {} }),
    });
    renderAt('/');
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    const buttons = screen.getAllByRole('button');
    const last = buttons[buttons.length - 1]!;
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(buttons[0]);
  });
});
