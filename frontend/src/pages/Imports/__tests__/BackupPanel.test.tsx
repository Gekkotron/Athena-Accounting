import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BackupPanel } from '../BackupPanel';
import { pinLocale } from '../../../test/i18n';

// BackupPanel renders French strings by default (the app's current UI
// language). Preload the 'imports' namespace for both locales so
// `useTranslation` never suspends mid-render, then pin the active language
// to French so the existing French-literal assertions below keep matching
// real rendered text.
pinLocale('imports');

// jsdom's Blob/File implementation in this environment has no `.text()`
// method (BackupPanel reads the picked file via `File#text()`), so polyfill
// it locally for this file only.
if (typeof Blob.prototype.text !== 'function') {
  Blob.prototype.text = function (this: Blob) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../../api/client';
const apiMock = vi.mocked(api);

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><BackupPanel /></QueryClientProvider>);
}

beforeEach(() => { apiMock.mockReset(); });

describe('BackupPanel', () => {
  // The passphrase is mandatory: export stays disabled until it has 8+
  // characters (there is no plaintext export anymore).
  it('disables export until the passphrase has 8+ characters', async () => {
    const user = userEvent.setup();
    renderPanel();
    const exportBtn = screen.getByRole('button', { name: 'Exporter (JSON)' });
    expect(exportBtn).toBeDisabled();
    await user.type(screen.getByLabelText(/Phrase secrète/i), 'short');
    expect(exportBtn).toBeDisabled();
    await user.type(screen.getByLabelText(/Phrase secrète/i), '-mais-longue');
    expect(exportBtn).toBeEnabled();
  });

  it('picking a restore file then confirming fires api(/api/backup/import) with the parsed JSON', async () => {
    apiMock.mockResolvedValue({
      imported: {
        accounts: 1, categories: 2, accountFilenamePatterns: 0,
        rules: 0, transferRules: 0, transactions: 3,
      },
    });
    const user = userEvent.setup();
    renderPanel();

    const restoreInput = screen.getByLabelText(/Importer une sauvegarde/i) as HTMLInputElement;
    const dump = { accounts: [], transactions: [] };
    const file = new File([JSON.stringify(dump)], 'b.json', { type: 'application/json' });
    await user.upload(restoreInput, file);

    const dialog = await screen.findByRole('dialog', {}, { timeout: 3000 });
    await user.click(within(dialog).getByRole('button', { name: 'Effacer et restaurer' }));

    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    expect(apiMock).toHaveBeenCalledWith('/api/backup/import', { method: 'POST', json: dump });
  });

  it('exports via POST with the passphrase when one is filled in', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Blob(['{}'], { type: 'application/json' })),
    );
    const createUrl = vi.fn(() => 'blob:athena');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() }));
    const user = userEvent.setup();
    renderPanel();

    await user.type(screen.getByLabelText(/Phrase secrète/i), 'family-vault-2026');
    await user.click(screen.getByRole('button', { name: 'Exporter (JSON)' }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('/api/backup/export');
    expect(init?.method).toBe('POST');
    expect(String(init?.body)).toContain('family-vault-2026');
    fetchSpy.mockRestore();
  });

  it('never calls the server while the passphrase is too short', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const user = userEvent.setup();
    renderPanel();

    await user.type(screen.getByLabelText(/Phrase secrète/i), 'short');
    // Button is disabled — clicking is a no-op and fetch never fires.
    await user.click(screen.getByRole('button', { name: 'Exporter (JSON)' }));

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('asks for the passphrase when an encrypted file is picked and sends it along', async () => {
    apiMock.mockResolvedValue({
      imported: {
        accounts: 1, categories: 0, accountFilenamePatterns: 0,
        rules: 0, transferRules: 0, transactions: 0,
      },
    });
    const user = userEvent.setup();
    renderPanel();

    const env = { v: 'enc1', kdf: 'scrypt', salt: 'cw==', iv: 'aXY=', authTag: 'dGFn', ciphertext: 'Y3Q=' };
    const file = new File([JSON.stringify(env)], 'b.enc.json', { type: 'application/json' });
    await user.upload(screen.getByLabelText(/Importer une sauvegarde/i), file);

    const dialog = await screen.findByRole('dialog', {}, { timeout: 3000 });
    const passInput = within(dialog).getByLabelText(/Phrase secrète/i);
    await user.type(passInput, 'family-vault-2026');
    await user.click(within(dialog).getByRole('button', { name: 'Effacer et restaurer' }));

    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    expect(apiMock).toHaveBeenCalledWith('/api/backup/import', {
      method: 'POST',
      json: { ...env, passphrase: 'family-vault-2026' },
    });
  });
});
