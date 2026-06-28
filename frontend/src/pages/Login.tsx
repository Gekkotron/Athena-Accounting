import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { User } from '../api/types';

export function Login() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const status = useQuery({
    queryKey: ['onboarding-status'],
    queryFn: () => api<{ needsOnboarding: boolean }>('/api/onboarding/status'),
  });

  const isOnboarding = status.data?.needsOnboarding ?? false;

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  const login = useMutation({
    mutationFn: (input: { username: string; password: string }) =>
      api<{ user: User }>('/api/auth/login', { method: 'POST', json: input }),
    onSuccess: (data) => {
      qc.setQueryData(['me'], { user: data.user });
      navigate('/', { replace: true });
    },
    onError: (err: ApiError) => setError(err.message),
  });

  const create = useMutation({
    mutationFn: (input: { username: string; password: string }) =>
      api<{ user: User }>('/api/onboarding/create', { method: 'POST', json: input }),
    onSuccess: (data) => {
      qc.setQueryData(['me'], { user: data.user });
      navigate('/', { replace: true });
    },
    onError: (err: ApiError) => setError(err.message),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (isOnboarding) {
      if (password.length < 8) {
        setError('Le mot de passe doit faire au moins 8 caractères.');
        return;
      }
      if (password !== confirm) {
        setError('Les mots de passe ne correspondent pas.');
        return;
      }
      create.mutate({ username, password });
    } else {
      login.mutate({ username, password });
    }
  };

  const submitting = login.isPending || create.isPending;

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card w-full max-w-md p-8">
        <div className="mb-6">
          <div className="text-lg font-semibold tracking-tight text-slate-100">Athena</div>
          <div className="text-xs text-slate-500">
            {isOnboarding
              ? 'Première utilisation — créez votre identifiant et votre mot de passe.'
              : 'Connectez-vous pour accéder à vos comptes.'}
          </div>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <div>
            <label className="label mb-1 block">Identifiant</label>
            <input
              className="input w-full"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="label mb-1 block">Mot de passe</label>
            <input
              type="password"
              className="input w-full"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isOnboarding ? 'new-password' : 'current-password'}
              required
              minLength={isOnboarding ? 8 : 1}
            />
          </div>
          {isOnboarding && (
            <div>
              <label className="label mb-1 block">Confirmer</label>
              <input
                type="password"
                className="input w-full"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
                minLength={8}
              />
            </div>
          )}

          {error && (
            <div className="rounded-md border border-rose-900 bg-rose-950 px-3 py-2 text-sm text-rose-200">
              {error}
            </div>
          )}

          <button className="btn-primary w-full" disabled={submitting}>
            {submitting ? 'Patientez…' : isOnboarding ? 'Créer le compte' : 'Se connecter'}
          </button>
        </form>

        <div className="mt-6 text-xs text-slate-500">
          Auto-hébergé · vos données ne quittent pas votre réseau.
        </div>
      </div>
    </div>
  );
}
