import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { __resetForTest } from '../store';
import { registerSeedProvider } from '../index';
import { buildSeedState } from '../seed';

function withQC(node: React.ReactNode) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

beforeEach(() => {
  __resetForTest();
  registerSeedProvider(buildSeedState);
});

describe('DemoBanner', () => {
  it('renders nothing when VITE_DEMO is not set', async () => {
    vi.stubEnv('VITE_DEMO', '');
    // Fresh module load so IS_DEMO picks up the stubbed env.
    vi.resetModules();
    const { DemoBanner } = await import('../../../components/DemoBanner');
    const { container } = render(withQC(<DemoBanner />));
    expect(container.firstChild).toBeNull();
    vi.unstubAllEnvs();
  });

  it('renders + resets the store under VITE_DEMO=1', async () => {
    vi.stubEnv('VITE_DEMO', '1');
    vi.resetModules();
    // Re-import through the same module graph the banner sees, so
    // reset() targets the store instance the banner will mutate.
    const store = await import('../store');
    const seed = await import('../seed');
    store.__resetForTest();
    store.registerSeedProvider(seed.buildSeedState);
    const { DemoBanner } = await import('../../../components/DemoBanner');
    render(withQC(<DemoBanner />));

    // Mutate the store so we can see reset undo it.
    store.setState((s) => { s.transactions.length = 0; });
    expect(store.getState().transactions).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /Réinitialiser/ }));
    expect(store.getState().transactions.length).toBeGreaterThan(0);
    expect(screen.getByText(/Démo réinitialisée/)).toBeInTheDocument();
    vi.unstubAllEnvs();
  });
});
