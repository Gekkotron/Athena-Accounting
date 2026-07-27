import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SettingsSecurity } from '../SettingsSecurity';
import { pinLocale } from '../../test/i18n';

// SettingsSecurity renders French strings by default (the app's current UI
// language). Preload the 'settings' namespace for both locales so
// `useTranslation` never suspends mid-render, then pin the active language
// to French so the French-literal assertions below keep matching real
// rendered text.
pinLocale('settings');

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api, ApiError } from '../../api/client';
const apiMock = vi.mocked(api);

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><SettingsSecurity /></QueryClientProvider>);
}

beforeEach(() => { apiMock.mockReset(); });

describe('SettingsSecurity', () => {
  it('postgres driver shows only the pointer paragraph, no forms', async () => {
    apiMock.mockResolvedValue({ driver: 'postgres', encrypted: false, pendingDisable: false });
    renderPanel();
    expect(await screen.findByText(/docs\/users\/encryption-at-rest\.md/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Activer le chiffrement' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Mot de passe')).not.toBeInTheDocument();
  });

  it('disables the enable button until both fields are 8+ chars and match', async () => {
    apiMock.mockResolvedValue({ driver: 'pglite', encrypted: false, pendingDisable: false });
    const user = userEvent.setup();
    renderPanel();

    const submit = await screen.findByRole('button', { name: 'Activer le chiffrement' });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText('Mot de passe'), 'short');
    expect(submit).toBeDisabled();

    await user.clear(screen.getByLabelText('Mot de passe'));
    await user.type(screen.getByLabelText('Mot de passe'), 'longenough1');
    expect(submit).toBeDisabled(); // confirm still empty/mismatched

    await user.type(screen.getByLabelText('Confirmer le mot de passe'), 'longenough1');
    expect(submit).toBeEnabled();

    await user.clear(screen.getByLabelText('Confirmer le mot de passe'));
    await user.type(screen.getByLabelText('Confirmer le mot de passe'), 'different1');
    expect(submit).toBeDisabled();
  });

  it('shows the no-recovery warning on the enable form', async () => {
    apiMock.mockResolvedValue({ driver: 'pglite', encrypted: false, pendingDisable: false });
    renderPanel();
    expect(await screen.findByText(/irrécupérables/i)).toBeInTheDocument();
  });

  it('shows wrongPassword when disable is submitted with a bad password (403)', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/security') return { driver: 'pglite', encrypted: true, pendingDisable: false };
      if (path === '/api/security/disable') throw new ApiError('wrong password', 403, { error: 'wrong password' });
      throw new Error(`unexpected call: ${path}`);
    });
    const user = userEvent.setup();
    renderPanel();

    const disableSubmit = await screen.findByRole('button', { name: 'Désactiver le chiffrement' });
    await user.type(screen.getByLabelText('Mot de passe'), 'wrongpass1');
    await user.click(disableSubmit);

    await waitFor(() => expect(screen.getByText('Mot de passe incorrect.')).toBeInTheDocument());
  });

  it('shows a dedicated pending-disable state and hides the enable form', async () => {
    // The marker is single-valued on the backend: a pending disable always
    // reports encrypted:false (see backend/src/http/routes/security.ts —
    // 'disable-pending' is a distinct marker from 'encrypted'). Offering the
    // enable form here would fight the boot-time finalization.
    apiMock.mockResolvedValue({ driver: 'pglite', encrypted: false, pendingDisable: true });
    renderPanel();
    expect(
      await screen.findByText(/La désactivation du chiffrement est programmée/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Activer le chiffrement' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Changer le mot de passe' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Désactiver le chiffrement' })).not.toBeInTheDocument();
  });

  it('shows a confirmation after enabling encryption succeeds', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/security') return { driver: 'pglite', encrypted: false, pendingDisable: false };
      if (path === '/api/security/enable') return { ok: true };
      throw new Error(`unexpected call: ${path}`);
    });
    const user = userEvent.setup();
    renderPanel();

    await user.type(await screen.findByLabelText('Mot de passe'), 'longenough1');
    await user.type(screen.getByLabelText('Confirmer le mot de passe'), 'longenough1');
    await user.click(screen.getByRole('button', { name: 'Activer le chiffrement' }));

    await waitFor(() =>
      expect(
        screen.getByText('Chiffrement activé. Vos données sont désormais chiffrées au repos.'),
      ).toBeInTheDocument(),
    );
  });
});
