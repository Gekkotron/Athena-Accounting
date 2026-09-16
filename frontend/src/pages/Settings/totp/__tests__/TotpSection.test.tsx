import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TotpSection } from '../TotpSection';
import { pinLocale } from '../../../../test/i18n';

pinLocale('settings');

// qrcode is dynamically imported inside TotpEnrollModal. Stubbing it keeps
// the test hermetic (no PNG rendering, no library warm-up) and lets us
// assert that the enrol modal reached step 2 by finding the fake data URL.
vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn(async () => 'data:image/png;base64,STUB'),
  },
  toDataURL: vi.fn(async () => 'data:image/png;base64,STUB'),
}));

vi.mock('../../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../../api/client')>('../../../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api, ApiError } from '../../../../api/client';
const apiMock = vi.mocked(api);

type Handler = (path: string, init?: unknown) => unknown;

function renderSection(handler: Handler) {
  apiMock.mockImplementation(handler as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TotpSection />
    </QueryClientProvider>,
  );
}

beforeEach(() => { apiMock.mockReset(); });

describe('TotpSection', () => {
  it('renders the disabled state card with an "Activer" button', async () => {
    renderSection(async (path) => {
      if (path === '/api/auth/lock-status') return { mode: 'session', lockConfigured: false };
      if (path === '/api/auth/2fa/status') return { enabled: false, remainingRecoveryCodes: 0 };
      throw new Error(`unexpected: ${path}`);
    });
    expect(await screen.findByText(/double authentification/i)).toBeInTheDocument();
    expect(screen.getByText(/désactivée/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /activer/i })).toBeInTheDocument();
  });

  it('renders the enabled state with the remaining recovery-code count', async () => {
    renderSection(async (path) => {
      if (path === '/api/auth/lock-status') return { mode: 'session', lockConfigured: false };
      if (path === '/api/auth/2fa/status') return { enabled: true, remainingRecoveryCodes: 7 };
      throw new Error(`unexpected: ${path}`);
    });
    expect(await screen.findByText(/activée/i)).toBeInTheDocument();
    expect(screen.getByText(/7 codes de récupération restants/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /régénérer/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /désactiver/i })).toBeInTheDocument();
  });

  it('renders nothing in desktop mode (AUTH_MODE=none)', async () => {
    const { container } = renderSection(async (path) => {
      if (path === '/api/auth/lock-status') return { mode: 'none', lockConfigured: false };
      throw new Error(`unexpected: ${path}`);
    });
    // Wait for lock-status to resolve, then confirm the section did not
    // mount. Nothing renders when the caller is desktop-mode.
    await waitFor(() =>
      expect(container.querySelector('[data-testid="totp-section"]')).toBeNull(),
    );
  });

  it('enrol wizard happy path: password → QR + secret → wrong code error → correct code → recovery codes', async () => {
    const enrolledPasswords: string[] = [];
    const confirmedCodes: string[] = [];
    renderSection(async (path, init) => {
      if (path === '/api/auth/lock-status') return { mode: 'session', lockConfigured: false };
      if (path === '/api/auth/2fa/status') return { enabled: false, remainingRecoveryCodes: 0 };
      const body = (init as { json?: unknown } | undefined)?.json as Record<string, string> | undefined;
      if (path === '/api/auth/2fa/enroll') {
        enrolledPasswords.push(body!.password);
        return {
          secret: 'JBSWY3DPEHPK3PXP',
          otpauthUrl: 'otpauth://totp/Athena:julien?secret=JBSWY3DPEHPK3PXP&issuer=Athena',
        };
      }
      if (path === '/api/auth/2fa/confirm') {
        confirmedCodes.push(body!.code);
        if (body!.code === '000000') {
          throw new ApiError('invalid code', 401, {});
        }
        return { recoveryCodes: ['aaaa-bbbb', 'cccc-dddd', 'eeee-ffff', 'gggg-hhhh', 'iiii-jjjj', 'kkkk-llll', 'mmmm-nnnn', 'oooo-pppp', 'qqqq-rrrr', 'ssss-tttt'] };
      }
      throw new Error(`unexpected: ${path}`);
    });
    const u = userEvent.setup();
    await screen.findByRole('button', { name: /activer/i });
    await u.click(screen.getByRole('button', { name: /activer/i }));

    // Step 1 — password
    const passwordInput = await screen.findByLabelText(/mot de passe actuel/i);
    await u.type(passwordInput, 'julienpw');
    await u.click(screen.getByRole('button', { name: /continuer/i }));

    // Step 2 — QR + secret + code entry
    await screen.findByText(/scanner le qr code/i);
    expect(await screen.findByAltText(/qr/i)).toHaveAttribute('src', 'data:image/png;base64,STUB');
    expect(screen.getByText(/JBSWY3DPEHPK3PXP/)).toBeInTheDocument();
    expect(enrolledPasswords).toEqual(['julienpw']);

    const codeInput = screen.getByLabelText(/code à 6 chiffres/i);
    await u.type(codeInput, '000000');
    await u.click(screen.getByRole('button', { name: /vérifier/i }));
    expect(await screen.findByText(/code invalide/i)).toBeInTheDocument();

    await u.clear(codeInput);
    await u.type(codeInput, '123456');
    await u.click(screen.getByRole('button', { name: /vérifier/i }));

    // Step 3 — recovery codes
    await screen.findByText(/sauvegarder vos codes/i);
    expect(screen.getByText('aaaa-bbbb')).toBeInTheDocument();
    expect(screen.getByText('ssss-tttt')).toBeInTheDocument();
    expect(confirmedCodes).toEqual(['000000', '123456']);
    // Finish button is disabled until the "j'ai sauvegardé mes codes" checkbox is ticked.
    const finish = screen.getByRole('button', { name: /terminer/i });
    expect(finish).toBeDisabled();
    await u.click(screen.getByRole('checkbox', { name: /sauvegardé/i }));
    expect(finish).toBeEnabled();
  });

  it('disable modal requires both password and code', async () => {
    const calls: unknown[] = [];
    renderSection(async (path, init) => {
      if (path === '/api/auth/lock-status') return { mode: 'session', lockConfigured: false };
      if (path === '/api/auth/2fa/status') return { enabled: true, remainingRecoveryCodes: 5 };
      if (path === '/api/auth/2fa/disable') {
        calls.push((init as { json?: unknown } | undefined)?.json);
        return { ok: true };
      }
      throw new Error(`unexpected: ${path}`);
    });
    const u = userEvent.setup();
    await screen.findByRole('button', { name: /désactiver/i });
    await u.click(screen.getByRole('button', { name: /désactiver/i }));

    const dialog = await screen.findByRole('dialog', { name: /désactiver la 2fa/i });
    const submit = within(dialog).getByRole('button', { name: /désactiver/i });
    // With empty fields, submit is disabled so nothing hits the wire.
    expect(submit).toBeDisabled();

    await u.type(within(dialog).getByLabelText(/mot de passe/i), 'julienpw');
    await u.type(within(dialog).getByLabelText(/code totp/i), '123456');
    expect(submit).toBeEnabled();
    await u.click(submit);
    await waitFor(() => expect(calls).toEqual([{ password: 'julienpw', code: '123456' }]));
  });

  it('regenerate replaces the codes shown last time', async () => {
    let regenCount = 0;
    renderSection(async (path) => {
      if (path === '/api/auth/lock-status') return { mode: 'session', lockConfigured: false };
      if (path === '/api/auth/2fa/status') return { enabled: true, remainingRecoveryCodes: 3 };
      if (path === '/api/auth/2fa/regenerate-codes') {
        regenCount++;
        return {
          recoveryCodes: regenCount === 1
            ? ['old1-old1', 'old2-old2', 'old3-old3', 'old4-old4', 'old5-old5', 'old6-old6', 'old7-old7', 'old8-old8', 'old9-old9', 'old0-old0']
            : ['new1-new1', 'new2-new2', 'new3-new3', 'new4-new4', 'new5-new5', 'new6-new6', 'new7-new7', 'new8-new8', 'new9-new9', 'new0-new0'],
        };
      }
      throw new Error(`unexpected: ${path}`);
    });
    const u = userEvent.setup();
    await screen.findByRole('button', { name: /régénérer/i });
    await u.click(screen.getByRole('button', { name: /régénérer/i }));
    const dialog = await screen.findByRole('dialog', { name: /régénérer les codes/i });
    await u.type(within(dialog).getByLabelText(/mot de passe/i), 'julienpw');
    await u.click(within(dialog).getByRole('button', { name: /régénérer/i }));
    expect(await screen.findByText('old1-old1')).toBeInTheDocument();
    // Confirm-checkbox + Finish → close.
    await u.click(screen.getByRole('checkbox', { name: /sauvegardé/i }));
    await u.click(screen.getByRole('button', { name: /terminer/i }));

    // Now regenerate again: fresh codes replace the previous ones.
    await u.click(screen.getByRole('button', { name: /régénérer/i }));
    const dialog2 = await screen.findByRole('dialog', { name: /régénérer les codes/i });
    await u.type(within(dialog2).getByLabelText(/mot de passe/i), 'julienpw');
    await u.click(within(dialog2).getByRole('button', { name: /régénérer/i }));
    expect(await screen.findByText('new1-new1')).toBeInTheDocument();
    expect(screen.queryByText('old1-old1')).toBeNull();
  });
});
