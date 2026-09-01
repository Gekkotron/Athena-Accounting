import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SettingsNotifications } from '../SettingsNotifications';
import { DEFAULTS, mergeNotifications, type Settings, type NotificationPrefsPatch } from '../../../lib/settings';
import { pinLocale } from '../../../test/i18n';

pinLocale('settings');

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  api: vi.fn(),
}));
import { api, ApiError } from '../../../api/client';
const mockedApi = vi.mocked(api);

vi.mock('../../../lib/notifications/channels/webPush', () => ({
  requestWebPushPermission: vi.fn().mockResolvedValue('granted'),
  sendWebPush: vi.fn(),
}));
import { requestWebPushPermission } from '../../../lib/notifications/channels/webPush';
const mockedRequestPermission = vi.mocked(requestWebPushPermission);

const ACCOUNT = { id: 3, name: 'Courant', type: 'checking', currency: 'EUR', openingBalance: '0.00', openingDate: '2025-01-01' };

function mount(initial: Settings = DEFAULTS) {
  let current = initial;
  mockedApi.mockImplementation(async (path: string, init?: { method?: string; json?: unknown }) => {
    if (path === '/api/accounts') return { accounts: [ACCOUNT] };
    if (path === '/api/settings' && init?.method === 'PATCH') {
      const patch = init.json as { notifications?: NotificationPrefsPatch } | undefined;
      current = { ...current, notifications: mergeNotifications(current.notifications, patch?.notifications) };
      return { settings: current };
    }
    if (path === '/api/settings') return { settings: current };
    if (path === '/api/notifications/test' && init?.method === 'POST') {
      throw new ApiError('notifications_disabled', 422, { error: 'notifications_disabled' });
    }
    throw new Error(`unexpected: ${path}`);
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><SettingsNotifications /></QueryClientProvider>,
  );
}

beforeEach(() => { mockedApi.mockReset(); mockedRequestPermission.mockClear(); });

describe('SettingsNotifications', () => {
  it('renders three tabs and switches panels on click', async () => {
    const u = userEvent.setup();
    mount();
    const channelsTab = await screen.findByRole('tab', { name: /canaux/i });
    expect(channelsTab).toHaveAttribute('aria-selected', 'true');
    // Privacy toggle only exists in the Confidentialité tab's panel.
    expect(screen.queryByLabelText(/masquer le montant/i)).toBeNull();
    await u.click(screen.getByRole('tab', { name: /confidentialité/i }));
    expect(screen.getByLabelText(/masquer le montant/i)).toBeInTheDocument();
    await u.click(screen.getByRole('tab', { name: /alertes/i }));
    expect(screen.getByLabelText(/grosse transaction/i)).toBeInTheDocument();
  });

  it('disables channel/privacy/trigger toggles when the master toggle is off', async () => {
    const u = userEvent.setup();
    mount({ ...DEFAULTS, notifications: { ...DEFAULTS.notifications, enabled: false } });
    // The hook paints DEFAULTS (enabled: true) before the settings query
    // resolves, so wait for the real (disabled) settings to land.
    await waitFor(() => expect(screen.getByLabelText(/notification dans l'application/i)).toBeDisabled());
    await u.click(screen.getByRole('tab', { name: /confidentialité/i }));
    expect(screen.getByLabelText(/masquer le montant/i)).toBeDisabled();
    await u.click(screen.getByRole('tab', { name: /alertes/i }));
    expect(screen.getByLabelText(/grosse transaction/i)).toBeDisabled();
  });

  it('enables children once the master toggle is turned on', async () => {
    const u = userEvent.setup();
    mount({ ...DEFAULTS, notifications: { ...DEFAULTS.notifications, enabled: false } });
    const master = await screen.findByLabelText(/activer les notifications/i);
    await u.click(master);
    await waitFor(() => expect(screen.getByLabelText(/notification dans l'application/i)).not.toBeDisabled());
  });

  it('renders the per-account threshold input as a text field with inputMode="decimal"', async () => {
    const u = userEvent.setup();
    mount();
    await u.click(await screen.findByRole('tab', { name: /alertes/i }));
    // Both the bigTransaction and accountLow cards render one per-account
    // amount row for "Courant" — the first is the bigTransaction threshold.
    const [input] = await screen.findAllByRole('textbox', { name: ACCOUNT.name });
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveAttribute('inputMode', 'decimal');
  });

  it('committing a threshold amount sends a PATCH keyed by account id', async () => {
    const u = userEvent.setup();
    mount();
    await u.click(await screen.findByRole('tab', { name: /alertes/i }));
    const [input] = await screen.findAllByRole('textbox', { name: ACCOUNT.name });
    await u.type(input, '150,50');
    await u.tab();
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/api/settings', {
      method: 'PATCH',
      json: { notifications: { triggers: { bigTransaction: { thresholds: { '3': 150.5 } } } } },
    }));
  });

  it('toggling "Notification du navigateur" on calls requestWebPushPermission', async () => {
    const u = userEvent.setup();
    mount();
    const webPushToggle = await screen.findByLabelText(/notification du navigateur/i);
    await u.click(webPushToggle);
    await waitFor(() => expect(mockedRequestPermission).toHaveBeenCalledTimes(1));
  });

  it('"Envoyer un test" fires the test-notification mutation', async () => {
    const u = userEvent.setup();
    mount();
    const button = await screen.findByRole('button', { name: /envoyer un test/i });
    await u.click(button);
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/api/notifications/test', { method: 'POST' }));
  });

  it('"Envoyer un test" on the Privacy tab previews a big_transaction sample', async () => {
    const u = userEvent.setup();
    mount();
    await u.click(await screen.findByRole('tab', { name: /confidentialité/i }));
    await u.click(screen.getByRole('button', { name: /envoyer un test/i }));
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/api/notifications/test', {
      method: 'POST',
      json: { kind: 'big_transaction' },
    }));
  });

  it('"Envoyer un test" on the Alerts tab previews a random trigger kind', async () => {
    const u = userEvent.setup();
    // Force Math.random to the second bucket (index 1 → 'account_low') so the
    // test asserts a deterministic kind rather than a member-of check.
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.3);
    try {
      mount();
      await u.click(await screen.findByRole('tab', { name: /alertes/i }));
      await u.click(screen.getByRole('button', { name: /envoyer un test/i }));
      await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/api/notifications/test', {
        method: 'POST',
        json: { kind: 'account_low' },
      }));
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('shows an inline hint when the test call 422s because notifications are disabled', async () => {
    const u = userEvent.setup();
    mockedApi.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/api/accounts') return { accounts: [ACCOUNT] };
      if (path === '/api/settings') return { settings: DEFAULTS };
      if (path === '/api/notifications/test' && init?.method === 'POST') {
        throw new ApiError('notifications_disabled', 422, { error: 'notifications_disabled' });
      }
      throw new Error(`unexpected: ${path}`);
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><SettingsNotifications /></QueryClientProvider>);
    const button = await screen.findByRole('button', { name: /envoyer un test/i });
    await u.click(button);
    await waitFor(() => expect(screen.getByText(/activez les notifications avant/i)).toBeInTheDocument());
  });
});
