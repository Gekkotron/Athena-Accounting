import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { Account, AccountFilenamePattern } from '../api/types';
import { formatAmount, formatDate, amountSignClass } from '../lib/format';

export function Accounts() {
  const qc = useQueryClient();
  const accountsQ = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api<{ accounts: Account[] }>('/api/accounts'),
  });
  const patternsQ = useQuery({
    queryKey: ['patterns'],
    queryFn: () =>
      api<{ patterns: AccountFilenamePattern[] }>('/api/account-filename-patterns'),
  });

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState('checking');
  const [currency, setCurrency] = useState('EUR');
  const [openingBalance, setOpeningBalance] = useState('0.00');
  const [openingDate, setOpeningDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (input: {
      name: string;
      type: string;
      currency: string;
      openingBalance: string;
      openingDate: string;
    }) =>
      api<{ account: Account }>('/api/accounts', {
        method: 'POST',
        json: input,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      setShowForm(false);
      setName('');
      setOpeningBalance('0.00');
    },
    onError: (err: ApiError) => setError(err.message),
  });

  const del = useMutation({
    mutationFn: (id: number) => api(`/api/accounts/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    create.mutate({ name, type, currency, openingBalance, openingDate });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Comptes</h1>
          <p className="text-sm text-slate-500">
            Le solde courant inclut le solde d'ouverture + toutes les transactions depuis cette date.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm((s) => !s)}>
          {showForm ? 'Annuler' : 'Nouveau compte'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={submit} className="card p-5 grid grid-cols-1 md:grid-cols-6 gap-3">
          <div className="md:col-span-2">
            <label className="label">Nom</label>
            <input className="input w-full" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <label className="label">Type</label>
            <select className="input w-full" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="checking">Courant</option>
              <option value="savings">Épargne</option>
              <option value="credit">Crédit</option>
              <option value="other">Autre</option>
            </select>
          </div>
          <div>
            <label className="label">Devise</label>
            <input
              className="input w-full"
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              maxLength={3}
              required
            />
          </div>
          <div>
            <label className="label">Solde d'ouverture</label>
            <input
              className="input w-full font-mono"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">Date d'ouverture</label>
            <input
              type="date"
              className="input w-full"
              value={openingDate}
              onChange={(e) => setOpeningDate(e.target.value)}
              required
            />
          </div>
          {error && (
            <div className="md:col-span-6 rounded-md border border-rose-900 bg-rose-950 px-3 py-2 text-sm text-rose-200">
              {error}
            </div>
          )}
          <div className="md:col-span-6">
            <button className="btn-primary" disabled={create.isPending}>
              {create.isPending ? 'Création…' : 'Créer le compte'}
            </button>
          </div>
        </form>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left">
            <tr className="border-b border-slate-800 text-slate-500 text-xs uppercase tracking-wider">
              <th className="px-4 py-3 font-normal">Nom</th>
              <th className="px-4 py-3 font-normal">Type</th>
              <th className="px-4 py-3 font-normal">Devise</th>
              <th className="px-4 py-3 font-normal">Ouvert le</th>
              <th className="px-4 py-3 font-normal text-right">Solde d'ouverture</th>
              <th className="px-4 py-3 font-normal text-right">Solde courant</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {(accountsQ.data?.accounts ?? []).map((a) => (
              <tr key={a.id} className="border-b border-slate-900 last:border-0">
                <td className="px-4 py-3 text-slate-200">{a.name}</td>
                <td className="px-4 py-3 text-slate-400">{a.type}</td>
                <td className="px-4 py-3 text-slate-400">{a.currency}</td>
                <td className="px-4 py-3 text-slate-400">{formatDate(a.openingDate)}</td>
                <td className="px-4 py-3 text-right font-mono text-slate-300">
                  {formatAmount(a.openingBalance, a.currency)}
                </td>
                <td className={`px-4 py-3 text-right font-mono ${amountSignClass(a.currentBalance ?? '0')}`}>
                  {formatAmount(a.currentBalance ?? '0', a.currency)}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    className="text-xs text-rose-300 hover:text-rose-200"
                    onClick={() => {
                      if (confirm(`Supprimer le compte « ${a.name} » ?`)) del.mutate(a.id);
                    }}
                  >
                    Supprimer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <PatternsSection patterns={patternsQ.data?.patterns ?? []} accounts={accountsQ.data?.accounts ?? []} />
    </div>
  );
}

function PatternsSection({
  patterns,
  accounts,
}: {
  patterns: AccountFilenamePattern[];
  accounts: Account[];
}) {
  const qc = useQueryClient();
  const [pattern, setPattern] = useState('');
  const [accountId, setAccountId] = useState<number | ''>('');
  const [priority, setPriority] = useState(0);

  const create = useMutation({
    mutationFn: (input: { pattern: string; accountId: number; priority: number }) =>
      api('/api/account-filename-patterns', { method: 'POST', json: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patterns'] });
      setPattern('');
    },
  });
  const del = useMutation({
    mutationFn: (id: number) => api(`/api/account-filename-patterns/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['patterns'] }),
  });

  const acctName = (id: number) => accounts.find((a) => a.id === id)?.name ?? `#${id}`;

  return (
    <div>
      <h2 className="text-sm font-medium text-slate-200 mb-3">
        Correspondance fichier → compte
      </h2>
      <p className="text-xs text-slate-500 mb-3">
        Quand vous importez un fichier, le compte cible est déduit du nom du fichier via ces motifs (priorité la plus
        haute d'abord). Exemple : « compte_courant » → Compte courant.
      </p>
      <div className="card p-3 flex flex-wrap items-end gap-3 mb-3">
        <div>
          <label className="label">Motif (sous-chaîne)</label>
          <input className="input w-56" value={pattern} onChange={(e) => setPattern(e.target.value)} />
        </div>
        <div>
          <label className="label">Compte</label>
          <select
            className="input w-44"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">—</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Priorité</label>
          <input
            type="number"
            className="input w-24"
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
          />
        </div>
        <button
          className="btn-secondary"
          onClick={() => {
            if (pattern && accountId) {
              create.mutate({ pattern, accountId, priority });
            }
          }}
          disabled={!pattern || !accountId}
        >
          Ajouter
        </button>
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left">
            <tr className="border-b border-slate-800 text-slate-500 text-xs uppercase tracking-wider">
              <th className="px-4 py-3 font-normal">Motif</th>
              <th className="px-4 py-3 font-normal">Compte</th>
              <th className="px-4 py-3 font-normal">Priorité</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {patterns.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                  Aucun motif configuré
                </td>
              </tr>
            ) : (
              patterns.map((p) => (
                <tr key={p.id} className="border-b border-slate-900 last:border-0">
                  <td className="px-4 py-2 text-slate-200 font-mono">{p.pattern}</td>
                  <td className="px-4 py-2 text-slate-300">{acctName(p.accountId)}</td>
                  <td className="px-4 py-2 text-slate-400">{p.priority}</td>
                  <td className="px-4 py-2 text-right">
                    <button className="text-xs text-rose-300 hover:text-rose-200" onClick={() => del.mutate(p.id)}>
                      Supprimer
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
