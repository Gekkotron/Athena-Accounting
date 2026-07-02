import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Profile } from '../Profile';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../api/client';
const apiMock = vi.mocked(api);

function renderProfile(username = 'julien') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['me'], { user: { id: 1, username } });
  return render(
    <QueryClientProvider client={client}>
      <Profile />
    </QueryClientProvider>,
  );
}

beforeEach(() => { apiMock.mockReset(); });

describe('Profile', () => {
  it('pre-fills the username from the me cache', () => {
    renderProfile('julien');
    const inputs = screen.getAllByRole('textbox');
    expect((inputs[0] as HTMLInputElement).value).toBe('julien');
  });

  it('rejects submits with nothing to change', async () => {
    const u = userEvent.setup();
    renderProfile('julien');
    // Only fill the "current password" field.
    // Password inputs have no htmlFor; grab them by type. Order at this
    // point (no new password typed): [newPassword, currentPassword].
    const pwds = Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[];
    const currentPwd = pwds[pwds.length - 1]!;
    await u.type(currentPwd, 'existing');
    await u.click(screen.getByRole('button', { name: /enregistrer/i }));
    expect(await screen.findByText(/rien à modifier/i)).toBeInTheDocument();
  });

  it('sends a rename PATCH when the username changed and current password is provided', async () => {
    const patches: any[] = [];
    apiMock.mockImplementation(async (path: string, init?: any) => {
      if (path === '/api/auth/me') {
        patches.push(init.json);
        return { user: { id: 1, username: init.json.username ?? 'julien' } };
      }
      throw new Error(`unexpected: ${path}`);
    });
    const u = userEvent.setup();
    renderProfile('julien');

    const inputs = screen.getAllByRole('textbox');
    await u.clear(inputs[0]!);
    await u.type(inputs[0]!, 'newname');
    // Password inputs have no htmlFor; grab them by type. Order at this
    // point (no new password typed): [newPassword, currentPassword].
    const pwds = Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[];
    const currentPwd = pwds[pwds.length - 1]!;
    await u.type(currentPwd, 'existing');

    await u.click(screen.getByRole('button', { name: /enregistrer/i }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ username: 'newname', currentPassword: 'existing' });
    expect(await screen.findByText(/profil mis à jour/i)).toBeInTheDocument();
  });

  it('rejects password change when the new password is too short', async () => {
    const u = userEvent.setup();
    renderProfile('julien');
    const pwdInputs = Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[];
    // Order: new password, confirm (only appears once new is non-empty), current password.
    await u.type(pwdInputs[0]!, 'short');
    // After typing, confirm becomes visible.
    const pwdInputs2 = Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[];
    await u.type(pwdInputs2[1]!, 'short');
    await u.type(pwdInputs2[2]!, 'currentpwd');
    await u.click(screen.getByRole('button', { name: /enregistrer/i }));
    expect(await screen.findByText(/au moins 8 caractères/i)).toBeInTheDocument();
  });

  it('rejects password change when the two new passwords do not match', async () => {
    const u = userEvent.setup();
    renderProfile('julien');
    const pwdInputs = Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[];
    await u.type(pwdInputs[0]!, 'longpassword1');
    const pwdInputs2 = Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[];
    await u.type(pwdInputs2[1]!, 'longpassword2');
    await u.type(pwdInputs2[2]!, 'existing');
    await u.click(screen.getByRole('button', { name: /enregistrer/i }));
    expect(await screen.findByText(/ne correspondent pas/i)).toBeInTheDocument();
  });

  it('surfaces server errors as-is', async () => {
    apiMock.mockImplementation(async () => {
      throw Object.assign(new Error('mot de passe actuel invalide'), { status: 400, name: 'ApiError', data: {} });
    });
    const u = userEvent.setup();
    renderProfile('julien');
    const inputs = screen.getAllByRole('textbox');
    await u.clear(inputs[0]!);
    await u.type(inputs[0]!, 'newname');
    // Password inputs have no htmlFor; grab them by type. Order at this
    // point (no new password typed): [newPassword, currentPassword].
    const pwds = Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[];
    const currentPwd = pwds[pwds.length - 1]!;
    await u.type(currentPwd, 'wrong');
    await u.click(screen.getByRole('button', { name: /enregistrer/i }));
    expect(await screen.findByText(/mot de passe actuel invalide/i)).toBeInTheDocument();
  });
});
