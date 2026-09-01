import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SettingsNotifications } from '../SettingsNotifications';
import { DEFAULTS } from '../../../lib/settings';
import { pinLocale } from '../../../test/i18n';

pinLocale('settings');

// Isolated from SettingsNotifications.test.tsx because it mocks
// lib/useSettings directly (module-level vi.mock is file-scoped), to force
// the mutation into an error state without needing a real failing PATCH.
vi.mock('../../../lib/useSettings', () => ({
  useSettings: () => ({
    settings: DEFAULTS,
    isReady: true,
    patch: vi.fn(),
    mutation: { isError: true, error: new Error('boom'), isSuccess: false, isPending: false },
  }),
}));

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  api: vi.fn().mockResolvedValue({ accounts: [] }),
}));

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><SettingsNotifications /></QueryClientProvider>,
  );
}

describe('SettingsNotifications — patch error', () => {
  it('shows an inline alert when the notifications settings mutation errors', async () => {
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent(/impossible d'enregistrer ce réglage/i);
  });
});
