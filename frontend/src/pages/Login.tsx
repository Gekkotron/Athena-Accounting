import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { User } from '../api/types';
import { Logo } from '../components/Logo';

export function Login() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const status = useQuery({
    queryKey: ['onboarding-status'],
    queryFn: () => api<{ needsOnboarding: boolean }>('/api/onboarding/status'),
  });

  const isOnboarding = status.data?.needsOnboarding ?? false;
  // Even after the first user exists, the registration endpoint is open so a
  // second person on the LAN can create their own account. The form toggles
  // between "se connecter" and "créer un compte" via this flag.
  const [registerMode, setRegisterMode] = useState(false);
  const isRegister = isOnboarding || registerMode;

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
    if (isRegister) {
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
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-8 flex flex-col items-center">
          <Logo size={60} className="text-sage-300" />
          <div className="display text-5xl text-ink-50 tracking-tight mt-5">Athena</div>
          <div className="display-italic text-base text-ink-400 mt-1">Accounting</div>
          <div className="mt-4 text-xs uppercase tracking-[0.2em] text-ink-500">
            Comptabilité auto-hébergée
          </div>
        </div>

        <div className="surface p-7 md:p-8">
          <div className="mb-6">
            <h1 className="text-lg font-semibold text-ink-50 mb-1">
              {isOnboarding ? 'Première utilisation' : isRegister ? 'Nouveau compte' : 'Bon retour'}
            </h1>
            <p className="text-sm text-ink-400">
              {isOnboarding
                ? 'Créez votre identifiant et votre mot de passe pour commencer.'
                : isRegister
                ? 'Choisissez un identifiant et un mot de passe. Vos données seront totalement séparées des autres utilisateurs.'
                : 'Connectez-vous pour accéder à vos comptes.'}
            </p>
          </div>

          <form onSubmit={submit} className="flex flex-col gap-4">
            <div>
              <label className="label mb-1.5 block">Identifiant</label>
              <input
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
                autoFocus
              />
            </div>
            <div>
              <label className="label mb-1.5 block">Mot de passe</label>
              <input
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                required
                minLength={isRegister ? 8 : 1}
              />
            </div>
            {isRegister && (
              <div>
                <label className="label mb-1.5 block">Confirmer</label>
                <input
                  type="password"
                  className="input"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={8}
                />
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200">
                {error}
              </div>
            )}

            <button className="btn-primary w-full" disabled={submitting}>
              {submitting ? 'Patientez…' : isRegister ? 'Créer le compte' : 'Se connecter'}
            </button>
          </form>

          {!isOnboarding && (
            <div className="mt-5 text-center text-sm text-ink-400">
              {registerMode ? (
                <>
                  Vous avez déjà un compte ?{' '}
                  <button
                    type="button"
                    className="text-sage-300 hover:text-sage-200 underline-offset-2 hover:underline"
                    onClick={() => { setRegisterMode(false); setError(null); }}
                  >Se connecter</button>
                </>
              ) : (
                <>
                  Pas encore de compte ?{' '}
                  <button
                    type="button"
                    className="text-sage-300 hover:text-sage-200 underline-offset-2 hover:underline"
                    onClick={() => { setRegisterMode(true); setError(null); }}
                  >Créer un compte</button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="mt-6 text-center text-[11px] text-ink-500">
          <span className="display-italic">Local-first.</span> Vos données ne quittent jamais votre réseau.
        </div>
      </div>
    </div>
  );
}
