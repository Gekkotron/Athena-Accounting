import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { SettingsSecurityPage } from '../Settings/SettingsSecurityPage';
import { pinLocale } from '../../test/i18n';

// Preload 'settings'/'common' for both locales and pin French so
// `useTranslation` never suspends mid-render and existing assertions keep
// matching real rendered text.
pinLocale('settings');

vi.mock('../../api/mcp', () => ({
  getMcpSettings: vi.fn().mockResolvedValue({ enabled: false, hasToken: false }),
  setMcpEnabled: vi.fn().mockResolvedValue({ enabled: true, hasToken: false }),
  generateMcpToken: vi.fn().mockResolvedValue({ token: 'EXAMPLE_TOKEN_123456789' }),
  revokeMcpToken: vi.fn().mockResolvedValue({ ok: true }),
}));

// SettingsSecurityPage also mounts SettingsSecurity + SettingsLock, which
// hit /api/security and /api/auth/lock-status. Both components early-return
// null when their status query has no data, so returning empty objects
// keeps the DOM focused on the MCP section this suite exercises.
vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, api: vi.fn().mockResolvedValue({}) };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><SettingsSecurityPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SettingsSecurityPage — Accès MCP', () => {
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
