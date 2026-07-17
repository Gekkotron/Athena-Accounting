import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Settings } from '../Settings';
import { withTips } from '../../test/renderWithProviders';
import i18n from '../../i18n';

// Preload 'settings'/'common' for both locales and pin French so
// `useTranslation` never suspends mid-render and existing assertions keep
// matching real rendered text.
beforeAll(async () => {
  await i18n.changeLanguage('fr');
  await i18n.loadNamespaces(['settings', 'common']);
});

vi.mock('../../api/mcp', () => ({
  getMcpSettings: vi.fn().mockResolvedValue({ enabled: false, hasToken: false }),
  setMcpEnabled: vi.fn().mockResolvedValue({ enabled: true, hasToken: false }),
  generateMcpToken: vi.fn().mockResolvedValue({ token: 'EXAMPLE_TOKEN_123456789' }),
  revokeMcpToken: vi.fn().mockResolvedValue({ ok: true }),
}));

// Minimal stubs so the rest of the Settings page renders.
vi.mock('../../lib/useSettings', () => ({
  useSettings: () => ({
    settings: { dashboardRange: '3m', dashboardChartScope: 'all', chartGapThresholdDays: 6, duplicateSimilarityThreshold: 0 },
    isReady: true, patch: vi.fn(), mutation: { isSuccess: false, isError: false, data: undefined },
  }),
}));
vi.mock('../../api/client', () => ({ api: vi.fn().mockResolvedValue({ accounts: [] }) }));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{withTips(<Settings />)}</QueryClientProvider>);
}

describe('Settings — Accès MCP', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the MCP section', async () => {
    renderPage();
    expect(await screen.findByTestId('mcp-section')).toBeInTheDocument();
  });

  it('reveals a token once after generate', async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId('mcp-generate'));
    await waitFor(() => expect(screen.getByTestId('mcp-token')).toHaveTextContent('EXAMPLE_TOKEN_123456789'));
  });
});
