import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { TipsProvider } from '../../contexts/TipsContext';
import { SectionTip } from '../SectionTip';
import { pinLocale } from '../../test/i18n';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

// SectionTip renders French strings by default (the app's current UI
// language). Preload 'tips' for both locales so `useTranslation` never
// suspends mid-render, then pin the active language to French so the
// existing French-literal assertions below keep matching real rendered text.
pinLocale('tips');

beforeEach(() => {
  fetchMock.mockReset();
});

describe('<SectionTip />', () => {
  it('renders the tip title + body when not dismissed', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, text: async () => JSON.stringify({ dismissed: {} }),
    });
    render(
      <TipsProvider>
        <SectionTip id="section:dashboard" />
      </TipsProvider>,
    );
    await waitFor(() => expect(screen.getByText(/tableau de bord/i)).toBeTruthy());
  });

  it('renders null when the id is already dismissed', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      text: async () => JSON.stringify({ dismissed: { 'section:dashboard': 'x' } }),
    });
    render(
      <TipsProvider>
        <SectionTip id="section:dashboard" />
      </TipsProvider>,
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText(/tableau de bord/i)).toBeNull();
  });

  it('clicking the close button dismisses the tip', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ dismissed: {} }) })
      .mockResolvedValueOnce({ ok: true, status: 204, text: async () => '' });
    render(
      <TipsProvider>
        <SectionTip id="section:budgets" />
      </TipsProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText(/Masquer ce conseil/)).toBeTruthy());
    fireEvent.click(screen.getByLabelText(/Masquer ce conseil/));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/tips/dismiss',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });
});
