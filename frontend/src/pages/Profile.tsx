import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { User } from '../api/types';

export function Profile() {
  const qc = useQueryClient();
  const me = qc.getQueryData<{ user: User }>(['me']);
  const currentName = me?.user?.username ?? '';

  const [username, setUsername] = useState(currentName);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: (input: { username?: string; currentPassword: string; newPassword?: string }) =>
      api<{ user: User }>('/api/auth/me', { method: 'PATCH', json: input }),
    onSuccess: (data) => {
      qc.setQueryData(['me'], { user: data.user });
      setOk('Profil mis à jour.');
      setNewPassword('');
      setConfirm('');
      setCurrentPassword('');
    },
    onError: (err: ApiError) => setError(err.message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);

    const wantsRename = username.trim().length > 0 && username.trim() !== currentName;
    const wantsPassword = newPassword.length > 0;

    if (!wantsRename && !wantsPassword) {
      setError('Rien à modifier.');
      return;
    }
    if (!currentPassword) {
      setError('Le mot de passe actuel est requis pour confirmer.');
      return;
    }
    if (wantsPassword) {
      if (newPassword.length < 8) {
        setError('Le nouveau mot de passe doit faire au moins 8 caractères.');
        return;
      }
      if (newPassword !== confirm) {
        setError('Les nouveaux mots de passe ne correspondent pas.');
        return;
      }
    }

    mut.mutate({
      ...(wantsRename ? { username: username.trim() } : {}),
      currentPassword,
      ...(wantsPassword ? { newPassword } : {}),
    });
  }

  return (
    <div className="max-w-xl flex flex-col gap-6">
      <div>
        <h1 className="display text-2xl text-ink-50">Profil</h1>
        <p className="text-sm text-ink-400 mt-1">
          Modifiez votre identifiant ou votre mot de passe. Le mot de passe actuel est demandé à chaque
          fois pour confirmer que c'est bien vous.
        </p>
      </div>

      <form onSubmit={submit} className="surface p-6 flex flex-col gap-4">
        <div>
          <label className="label mb-1.5 block">Identifiant</label>
          <input
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
          {currentName && username.trim() !== currentName && (
            <p className="text-xs text-ink-400 mt-1">
              Actuel : <span className="font-mono text-ink-300">{currentName}</span>
            </p>
          )}
        </div>

        <div className="pt-2 border-t border-ink-800/60">
          <div className="label mb-1.5">Nouveau mot de passe <span className="text-ink-500 font-normal">(optionnel)</span></div>
          <input
            type="password"
            className="input"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            minLength={newPassword.length > 0 ? 8 : undefined}
            placeholder="Laisser vide pour ne pas changer"
          />
        </div>

        {newPassword.length > 0 && (
          <div>
            <label className="label mb-1.5 block">Confirmer le nouveau mot de passe</label>
            <input
              type="password"
              className="input"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
        )}

        <div className="pt-2 border-t border-ink-800/60">
          <label className="label mb-1.5 block">Mot de passe actuel <span className="text-clay-300 font-normal">(requis)</span></label>
          <input
            type="password"
            className="input"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        {error && (
          <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200">
            {error}
          </div>
        )}
        {ok && (
          <div className="rounded-lg border border-sage-800/50 bg-sage-900/15 px-3 py-2 text-sm text-sage-200">
            {ok}
          </div>
        )}

        <button className="btn-primary" disabled={mut.isPending}>
          {mut.isPending ? 'Enregistrement…' : 'Enregistrer les modifications'}
        </button>
      </form>
    </div>
  );
}
