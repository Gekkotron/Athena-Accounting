import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PdfTemplatesPanel } from '../PdfTemplatesPanel';

vi.mock('../../../api/pdf-templates', () => ({
  listPdfTemplates: vi.fn(),
  deletePdfTemplate: vi.fn(),
}));
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: vi.fn() };
});

import { listPdfTemplates, deletePdfTemplate } from '../../../api/pdf-templates';
import { api } from '../../../api/client';
const listMock = vi.mocked(listPdfTemplates);
const deleteMock = vi.mocked(deletePdfTemplate);
const apiMock = vi.mocked(api);

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><PdfTemplatesPanel /></QueryClientProvider>);
}

const account = (id: number, name: string) => ({
  id, name, type: 'checking', currency: 'EUR',
  openingBalance: '0', openingDate: '2025-01-01',
  currentBalance: '0', availableBalance: '0',
  transactionCount: 0, countedTransactionCount: 0,
});

beforeEach(() => {
  listMock.mockReset();
  deleteMock.mockReset();
  apiMock.mockReset();
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/accounts') return { accounts: [account(1, 'Compte courant'), account(2, 'Livret A')] };
    throw new Error(`unexpected: ${path}`);
  });
});

describe('PdfTemplatesPanel', () => {
  it('shows the empty state when no templates exist', async () => {
    listMock.mockResolvedValueOnce([]);
    renderPanel();
    expect(await screen.findByText(/aucun template enregistré/i)).toBeInTheDocument();
  });

  it('lists templates with their account name and filter mode', async () => {
    listMock.mockResolvedValueOnce([
      {
        id: 10, fingerprint: 'abc', accountId: 1, label: 'BNP relevé mensuel',
        source: 'interactive', hasPageAnchor: true,
        createdAt: '2026-06-01T09:00:00Z', updatedAt: '2026-06-15T09:00:00Z',
      },
      {
        id: 11, fingerprint: 'def', accountId: 2, label: 'Livret A relevé annuel',
        source: 'heuristic', hasPageAnchor: false,
        createdAt: '2026-01-01T09:00:00Z', updatedAt: '2026-01-01T09:00:00Z',
      },
    ]);
    renderPanel();
    expect(await screen.findByText('BNP relevé mensuel')).toBeInTheDocument();
    expect(screen.getByText('Livret A relevé annuel')).toBeInTheDocument();
    expect(screen.getByText('Compte courant')).toBeInTheDocument();
    expect(screen.getByText('Livret A')).toBeInTheDocument();
    // Badge text is exactly "Par contenu" / "Par numéro (ancien)" — anchor
    // the regex to avoid colliding with the warning banner copy that also
    // mentions "par contenu" / "par numéros".
    expect(screen.getByText(/^par contenu$/i)).toBeInTheDocument();
    expect(screen.getByText(/^par numéro \(ancien\)$/i)).toBeInTheDocument();
  });

  it('surfaces a warning banner when at least one template still uses absolute-index filtering', async () => {
    listMock.mockResolvedValueOnce([
      {
        id: 11, fingerprint: 'def', accountId: 2, label: 'legacy',
        source: 'heuristic', hasPageAnchor: false,
        createdAt: '2026-01-01T09:00:00Z', updatedAt: '2026-01-01T09:00:00Z',
      },
    ]);
    renderPanel();
    expect(await screen.findByText(/utilise le filtrage par numéros de page absolus/i)).toBeInTheDocument();
  });

  it('deletes a template after confirming', async () => {
    listMock.mockResolvedValueOnce([
      {
        id: 10, fingerprint: 'abc', accountId: 1, label: 'BNP',
        source: 'interactive', hasPageAnchor: true,
        createdAt: '2026-06-01T09:00:00Z', updatedAt: '2026-06-15T09:00:00Z',
      },
    ]);
    // After delete, the query invalidates and refetches — return an empty list.
    listMock.mockResolvedValueOnce([]);
    deleteMock.mockResolvedValueOnce(undefined);

    const user = userEvent.setup();
    renderPanel();
    await screen.findByText('BNP');
    await user.click(screen.getByRole('button', { name: /^supprimer$/i }));
    // ConfirmDialog opens with its own "Supprimer" button.
    const confirmBtn = await screen.findAllByRole('button', { name: /^supprimer$/i });
    // Two buttons now: the row one AND the confirm one. Click the last (the dialog's).
    await user.click(confirmBtn[confirmBtn.length - 1]!);
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith(10));
  });
});
