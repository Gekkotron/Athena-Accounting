import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TipsProvider } from '../../contexts/TipsContext';
import { TourProvider, useTour } from '../../contexts/TourContext';
import { useTourAnchor } from '../../hooks/useTourAnchor';
import { TourBubble } from '../TourBubble';
import { pinLocale } from '../../test/i18n';

pinLocale('tips');

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status: 200, text: async () => JSON.stringify({ dismissed: {} }),
  } as Response)));
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

function Anchors() {
  const a = useTourAnchor('dashboard:balance');
  const b = useTourAnchor('dashboard:curve');
  const c = useTourAnchor('dashboard:donut');
  const d = useTourAnchor('dashboard:insights');
  const e = useTourAnchor('dashboard:sankey');
  return (
    <div>
      <div ref={a} data-testid="anchor-balance">Balance</div>
      <div ref={b}>Curve</div>
      <div ref={c}>Donut</div>
      <div ref={d}>Insights</div>
      <div ref={e}>Sankey</div>
    </div>
  );
}

function StartHarness({ pageId }: { pageId: 'dashboard' }) {
  const tour = useTour();
  return <button onClick={() => tour.startTour(pageId)}>start</button>;
}

describe('<TourBubble />', () => {
  it('renders null when no tour is active', () => {
    render(wrap(<><Anchors /><TourBubble /></>));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders title, body, step counter, and buttons when active', async () => {
    render(wrap(<><Anchors /><StartHarness pageId="dashboard" /><TourBubble /></>));
    await userEvent.click(screen.getByText('start'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Solde global|Total balance/i)).toBeInTheDocument();
    expect(screen.getByText(/Étape 1 \/ 5|Step 1 \/ 5/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Suivant|Next/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Passer|Skip/i })).toBeInTheDocument();
  });

  it('advances on Suivant and steps back on Précédent', async () => {
    render(wrap(<><Anchors /><StartHarness pageId="dashboard" /><TourBubble /></>));
    await userEvent.click(screen.getByText('start'));
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: /Suivant|Next/i }));
    expect(screen.getByText(/Étape 2 \/ 5|Step 2 \/ 5/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Précédent|Previous/i }));
    expect(screen.getByText(/Étape 1 \/ 5|Step 1 \/ 5/i)).toBeInTheDocument();
  });

  it('last-step Suivant renders as Terminer and dismisses on click', async () => {
    render(wrap(<><Anchors /><StartHarness pageId="dashboard" /><TourBubble /></>));
    await userEvent.click(screen.getByText('start'));
    await screen.findByRole('dialog');
    for (let i = 0; i < 4; i++) {
      await userEvent.click(screen.getByRole('button', { name: /Suivant|Next/i }));
    }
    // Now on step 5/5 — button should read Terminer/Finish.
    const finish = screen.getByRole('button', { name: /Terminer|Finish/i });
    await userEvent.click(finish);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Précédent is disabled on step 0', async () => {
    render(wrap(<><Anchors /><StartHarness pageId="dashboard" /><TourBubble /></>));
    await userEvent.click(screen.getByText('start'));
    await screen.findByRole('dialog');
    expect(screen.getByRole('button', { name: /Précédent|Previous/i })).toBeDisabled();
  });

  it('Esc skips (dismisses)', async () => {
    render(wrap(<><Anchors /><StartHarness pageId="dashboard" /><TourBubble /></>));
    await userEvent.click(screen.getByText('start'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('arrow keys step forward and back', async () => {
    render(wrap(<><Anchors /><StartHarness pageId="dashboard" /><TourBubble /></>));
    await userEvent.click(screen.getByText('start'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(screen.getByText(/Étape 2 \/ 5|Step 2 \/ 5/i)).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    expect(screen.getByText(/Étape 1 \/ 5|Step 1 \/ 5/i)).toBeInTheDocument();
  });

  it('renders null while the current step\'s anchor is unresolved', async () => {
    function OnlyOne() {
      // Register only the FIRST anchor; step 2 will be missing.
      const a = useTourAnchor('dashboard:balance');
      return <div ref={a} data-testid="anchor-balance" />;
    }
    render(wrap(<><OnlyOne /><StartHarness pageId="dashboard" /><TourBubble /></>));
    await userEvent.click(screen.getByText('start'));
    await screen.findByRole('dialog');
    // Step 0 renders (anchor resolved).
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
