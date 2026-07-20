import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TipsProvider } from '../../contexts/TipsContext';
import { TourProvider, useTour } from '../../contexts/TourContext';
import { useTourAnchor } from '../useTourAnchor';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status: 200, text: async () => JSON.stringify({ dismissed: {} }),
  } as Response)));
});

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter>
      <TipsProvider>
        <TourProvider>{children}</TourProvider>
      </TipsProvider>
    </MemoryRouter>
  );
}

function Probe() {
  const tour = useTour();
  const node = tour.getAnchor('dashboard:balance');
  return <span data-testid="probe">{node ? 'yes' : 'no'}</span>;
}

function Target() {
  const ref = useTourAnchor('dashboard:balance');
  return <div ref={ref} data-testid="target" />;
}

describe('useTourAnchor', () => {
  it('registers on mount and clears on unmount', () => {
    function Root({ show }: { show: boolean }) {
      return <>{show && <Target />}<Probe /></>;
    }
    const { rerender } = render(<Wrap><Root show={true} /></Wrap>);
    // Wait a microtask so refs flush + provider re-renders.
    expect(screen.getByTestId('probe').textContent).toBe('yes');
    rerender(<Wrap><Root show={false} /></Wrap>);
    expect(screen.getByTestId('probe').textContent).toBe('no');
  });
});
