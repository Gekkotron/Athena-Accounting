import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BalanceCheckpointsDrawer } from '../BalanceCheckpointsDrawer';
import { ApiError } from '../../../api/client';
import { pinLocale } from '../../../test/i18n';

// BalanceCheckpointsDrawer uses the 'accounts' namespace. Preload it for
// both locales, pinned to French, so `useTranslation` never suspends and
// the existing French-literal assertions below keep matching real
// rendered text.
pinLocale('accounts');

vi.mock('../../../api/checkpoints');
import * as checkpointsApi from '../../../api/checkpoints';
const listMock = vi.mocked(checkpointsApi.listCheckpoints);
const createMock = vi.mocked(checkpointsApi.createCheckpoint);
const delMock = vi.mocked(checkpointsApi.deleteCheckpoint);
const patchMock = vi.mocked(checkpointsApi.updateCheckpoint);

function renderDrawer(accountId = 1, currency = 'EUR') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BalanceCheckpointsDrawer accountId={accountId} currency={currency} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  listMock.mockReset();
  createMock.mockReset();
  delMock.mockReset();
  patchMock.mockReset();
});

describe('BalanceCheckpointsDrawer', () => {
  it('shows empty state text when no checkpoints', async () => {
    listMock.mockResolvedValueOnce({ checkpoints: [] });
    renderDrawer();
    expect(await screen.findByText(/aucun point de contrôle/i)).toBeInTheDocument();
  });

  it('submits and displays a new checkpoint', async () => {
    listMock.mockResolvedValueOnce({ checkpoints: [] });
    createMock.mockResolvedValueOnce({ checkpoint: {
      id: 1, accountId: 1, checkpointDate: '2025-06-01',
      expectedAmount: '100.00', note: null, createdAt: '2026-01-01T00:00:00Z' } });
    listMock.mockResolvedValueOnce({ checkpoints: [{
      id: 1, accountId: 1, checkpointDate: '2025-06-01',
      expectedAmount: '100.00', note: null, createdAt: '2026-01-01T00:00:00Z' }] });

    const user = userEvent.setup();
    renderDrawer();
    // jsdom's `type="date"` input doesn't accept typed "YYYY-MM-DD" keystrokes,
    // so set the value directly and fire the change event the component listens for.
    fireEvent.change(await screen.findByLabelText(/date du point de contrôle/i), { target: { value: '2025-06-01' } });
    await user.type(screen.getByLabelText(/montant attendu/i), '100.00');
    await user.click(screen.getByRole('button', { name: '+ ajouter' }));

    expect(createMock).toHaveBeenCalledWith(1, expect.objectContaining({
      checkpointDate: '2025-06-01', expectedAmount: '100.00',
    }));
    expect(await screen.findByText('2025-06-01')).toBeInTheDocument();
  });

  it('shows 409 error text inline', async () => {
    listMock.mockResolvedValue({ checkpoints: [] });
    createMock.mockRejectedValueOnce(new ApiError('checkpoint_exists', 409, { error: 'checkpoint_exists', date: '2025-06-01' }));

    const user = userEvent.setup();
    renderDrawer();
    fireEvent.change(await screen.findByLabelText(/date du point de contrôle/i), { target: { value: '2025-06-01' } });
    await user.type(screen.getByLabelText(/montant attendu/i), '100.00');
    await user.click(screen.getByRole('button', { name: '+ ajouter' }));

    expect(await screen.findByText(/existe déjà à cette date sur ce compte/i)).toBeInTheDocument();
  });

  it('maps a 400 with an expectedAmount issue to an actionable French message', async () => {
    listMock.mockResolvedValue({ checkpoints: [] });
    createMock.mockRejectedValueOnce(new ApiError('invalid input', 400, {
      error: 'invalid input',
      issues: [{ path: ['expectedAmount'], message: 'must be a decimal' }],
    }));

    const user = userEvent.setup();
    renderDrawer();
    fireEvent.change(await screen.findByLabelText(/date du point de contrôle/i), { target: { value: '2025-06-01' } });
    await user.type(screen.getByLabelText(/montant attendu/i), 'not-a-number');
    await user.click(screen.getByRole('button', { name: '+ ajouter' }));

    expect(await screen.findByText(/montant invalide/i)).toBeInTheDocument();
  });

  it('maps a 400 with a note issue to a "note too long" message', async () => {
    listMock.mockResolvedValue({ checkpoints: [] });
    createMock.mockRejectedValueOnce(new ApiError('invalid input', 400, {
      error: 'invalid input',
      issues: [{ path: ['note'], message: 'note too long (max 200)' }],
    }));

    const user = userEvent.setup();
    renderDrawer();
    fireEvent.change(await screen.findByLabelText(/date du point de contrôle/i), { target: { value: '2025-06-01' } });
    await user.type(screen.getByLabelText(/montant attendu/i), '100');
    await user.type(screen.getByLabelText(/^note$/i), 'x');
    await user.click(screen.getByRole('button', { name: '+ ajouter' }));

    expect(await screen.findByText(/note trop longue/i)).toBeInTheDocument();
  });

  it('maps a delete 404 to a specific "introuvable" message', async () => {
    listMock.mockResolvedValueOnce({ checkpoints: [{
      id: 1, accountId: 1, checkpointDate: '2025-06-01',
      expectedAmount: '100.00', note: null, createdAt: '2026-01-01T00:00:00Z' }] });
    delMock.mockRejectedValueOnce(new ApiError('not found', 404, { error: 'not found' }));

    const user = userEvent.setup();
    renderDrawer();
    await user.click(await screen.findByRole('button', { name: /supprimer/i }));

    expect(await screen.findByText(/introuvable/i)).toBeInTheDocument();
  });

  it('clears mutationError after a subsequent successful mutation', async () => {
    listMock.mockResolvedValue({ checkpoints: [] });
    createMock.mockRejectedValueOnce(new ApiError('checkpoint_exists', 409, {
      error: 'checkpoint_exists', date: '2025-06-01' }));
    createMock.mockResolvedValueOnce({ checkpoint: {
      id: 2, accountId: 1, checkpointDate: '2025-07-01',
      expectedAmount: '200.00', note: null, createdAt: '2026-01-01T00:00:00Z' } });
    listMock.mockResolvedValueOnce({ checkpoints: [{
      id: 2, accountId: 1, checkpointDate: '2025-07-01',
      expectedAmount: '200.00', note: null, createdAt: '2026-01-01T00:00:00Z' }] });

    const user = userEvent.setup();
    renderDrawer();
    // First attempt fails.
    fireEvent.change(await screen.findByLabelText(/date du point de contrôle/i), { target: { value: '2025-06-01' } });
    await user.type(screen.getByLabelText(/montant attendu/i), '100.00');
    await user.click(screen.getByRole('button', { name: '+ ajouter' }));
    await screen.findByText(/existe déjà à cette date sur ce compte/i);

    // Second attempt succeeds — error must clear.
    fireEvent.change(screen.getByLabelText(/date du point de contrôle/i), { target: { value: '2025-07-01' } });
    await user.clear(screen.getByLabelText(/montant attendu/i));
    await user.type(screen.getByLabelText(/montant attendu/i), '200.00');
    await user.click(screen.getByRole('button', { name: '+ ajouter' }));

    await waitFor(() => expect(screen.queryByText(/existe déjà à cette date sur ce compte/i)).not.toBeInTheDocument());
  });
});
