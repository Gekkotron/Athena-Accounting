import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TransactionAttachments } from '../TransactionAttachments';
import { pinLocale } from '../../../test/i18n';

pinLocale('transactions');

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>(
    '../../../api/client',
  );
  return { ...actual, api: vi.fn(), apiUpload: vi.fn() };
});
import { api, apiUpload } from '../../../api/client';
const apiMock = vi.mocked(api);
const uploadMock = vi.mocked(apiUpload);

function withProvider(children: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  apiMock.mockReset();
  uploadMock.mockReset();
});

describe('TransactionAttachments', () => {
  it('renders the "save first" hint when transactionId is null (create mode)', () => {
    render(withProvider(<TransactionAttachments transactionId={null} />));
    expect(
      screen.getByText(/Enregistrez d'abord la transaction/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ajouter/i })).not.toBeInTheDocument();
  });

  it('shows the empty state when the list endpoint returns no rows', async () => {
    apiMock.mockResolvedValue({ attachments: [] });
    render(withProvider(<TransactionAttachments transactionId={42} />));
    expect(await screen.findByText(/Aucune pièce jointe/i)).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith('/api/transactions/42/attachments');
  });

  it('lists existing attachments with size and a download link', async () => {
    apiMock.mockResolvedValue({
      attachments: [
        {
          id: 1,
          transactionId: 42,
          filename: 'ticket.pdf',
          mime: 'application/pdf',
          sizeBytes: 2048,
          createdAt: '2026-08-13T09:00:00.000Z',
        },
      ],
    });
    render(withProvider(<TransactionAttachments transactionId={42} />));
    expect(await screen.findByText('ticket.pdf')).toBeInTheDocument();
    expect(screen.getByText('2.0 Ko')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Télécharger/i });
    expect(link.getAttribute('href')).toBe('/api/attachments/1/download');
    expect(link.getAttribute('download')).toBe('ticket.pdf');
  });

  it('rejects an over-cap file client-side without hitting the upload endpoint', async () => {
    apiMock.mockResolvedValue({ attachments: [] });
    render(withProvider(<TransactionAttachments transactionId={42} />));
    // Wait for the initial list to settle so the Add button is rendered.
    await screen.findByText(/Aucune pièce jointe/i);
    const oversize = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'huge.png', {
      type: 'image/png',
    });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, oversize);
    expect(uploadMock).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByText(/Fichier trop volumineux/i)).toBeInTheDocument(),
    );
  });

  it('calls apiUpload with the selected file when the picker fires', async () => {
    apiMock.mockResolvedValue({ attachments: [] });
    uploadMock.mockResolvedValue({
      attachment: {
        id: 7,
        transactionId: 42,
        filename: 'r.png',
        mime: 'image/png',
        sizeBytes: 1024,
        createdAt: '2026-08-13T09:00:00.000Z',
      },
    });
    render(withProvider(<TransactionAttachments transactionId={42} />));
    await screen.findByText(/Aucune pièce jointe/i);
    const file = new File([new Uint8Array(1024)], 'r.png', { type: 'image/png' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, file);
    await waitFor(() =>
      expect(uploadMock).toHaveBeenCalledWith('/api/transactions/42/attachments', file),
    );
  });
});
