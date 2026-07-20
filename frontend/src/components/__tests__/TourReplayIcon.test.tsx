import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { pinLocale } from '../../test/i18n';
import { TipsProvider } from '../../contexts/TipsContext';
import { TourProvider, useTour } from '../../contexts/TourContext';
import { TourReplayIcon } from '../TourReplayIcon';

pinLocale('tips');

function stub(dismissed: Record<string, string>) {
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

function wrap(node: React.ReactNode) {
  return (
    <MemoryRouter>
      <TipsProvider>
        <TourProvider>{node}</TourProvider>
      </TipsProvider>
    </MemoryRouter>
  );
}

function Probe() {
  const tour = useTour();
  return <span data-testid="active">{tour.activePageId ?? 'none'}</span>;
}

beforeEach(() => vi.resetAllMocks());

describe('<TourReplayIcon />', () => {
  it('is hidden when the tour is not dismissed', async () => {
    stub({});
    render(wrap(<TourReplayIcon pageId="dashboard" />));
    await waitFor(() => expect(document.querySelector('button')).toBeNull());
  });

  it('is visible when dismissed; click undismisses and starts the tour', async () => {
    stub({ 'tour:dashboard': '2026-07-01T00:00:00Z' });
    render(wrap(<><TourReplayIcon pageId="dashboard" /><Probe /></>));
    const btn = await screen.findByRole('button', { name: /Rejouer|Replay/i });
    await userEvent.click(btn);
    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe('dashboard'));
  });
});
