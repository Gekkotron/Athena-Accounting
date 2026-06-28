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
    queryFn: () => api<{ patterns: AccountFilenamePattern[] }>('/api/account-filename-patterns'),
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
    }) => api<{ account: Account }>('/api/accounts', { method: 'POST', json: input }),
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
    <div className="flex flex-col gap-8">
      <div className="page-header">
        <div>
          <h1 className="page-title">Comptes</h1>
          <p className="page-subtitle">
            <span className="display-italic">Solde courant</span> = solde d'ouverture + somme des transactions depuis cette date.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm((s) => !s)}>
          {showForm ? 'Annuler' : 'Nouveau compte'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={submit} className="surface p-5 md:p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
          <div className="lg:col-span-2">
            <label className="label mb-1.5 block">Nom</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <label className="label mb-1.5 block">Type</label>
            <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="checking">Courant</option>
              <option value="savings">Épargne</option>
              <option value="credit">Crédit</option>
              <option value="other">Autre</option>
            </select>
          </div>
          <div>
            <label className="label mb-1.5 block">Devise</label>
            <input
              className="input"
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              maxLength={3}
              required
            />
          </div>
          <div>
            <label className="label mb-1.5 block">Solde d'ouverture</label>
            <input
              className="input font-mono"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label mb-1.5 block">Date d'ouverture</label>
            <input
              type="date"
              className="input"
              value={openingDate}
              onChange={(e) => setOpeningDate(e.target.value)}
              required
            />
          </div>
          {error && (
            <div className="sm:col-span-2 lg:col-span-6 rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200">
              {error}
            </div>
          )}
          <div className="sm:col-span-2 lg:col-span-6">
            <button className="btn-primary" disabled={create.isPending}>
              {create.isPending ? 'Création…' : 'Créer le compte'}
            </button>
          </div>
        </form>
      )}

      <section>
        <div className="section-rule mb-4">Mes comptes</div>
        {(accountsQ.data?.accounts ?? []).length === 0 ? (
          <div className="surface p-6 text-sm text-ink-400 display-italic">
            Aucun compte pour l'instant.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {(accountsQ.data?.accounts ?? []).map((a) => (
              <div key={a.id} className="surface p-5 relative">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="text-sm font-medium text-ink-100 truncate">{a.name}</div>
                  <span className="badge">{a.currency}</span>
                </div>
                <div className="label mt-0.5">{a.type}</div>
                <div className={`display mt-4 text-3xl tabular-nums ${amountSignClass(a.currentBalance ?? '0')}`}>
                  {formatAmount(a.currentBalance ?? '0', a.currency)}
                </div>
                <div className="text-[11px] text-ink-500 mt-3 font-mono leading-relaxed">
                  ouvert {formatDate(a.openingDate)} · {formatAmount(a.openingBalance, a.currency)}
                </div>
                <button
                  className="absolute top-3 right-3 text-[11px] text-ink-500 hover:text-clay-300 transition"
                  onClick={() => {
                    if (confirm(`Supprimer le compte « ${a.name} » ?`)) del.mutate(a.id);
                  }}
                >
                  supprimer
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

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
    <section>
      <div className="section-rule mb-2">Fichier → compte</div>
      <p className="text-xs text-ink-500 mb-4 max-w-xl">
        À l'import, le compte cible est déduit du nom du fichier via ces motifs (priorité la plus haute d'abord).
        <span className="display-italic"> Exemple :</span> motif « compte_courant » → Compte courant.
      </p>
      <div className="surface p-4 mb-3 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[180px]">
          <label className="label mb-1.5 block">Motif</label>
          <input className="input" value={pattern} onChange={(e) => setPattern(e.target.value)} />
        </div>
        <div className="w-full sm:w-44">
          <label className="label mb-1.5 block">Compte</label>
          <select
            className="input"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">—</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div className="w-24">
          <label className="label mb-1.5 block">Priorité</label>
          <input
            type="number"
            className="input font-mono"
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
          />
        </div>
        <button
          className="btn-secondary"
          onClick={() => pattern && accountId && create.mutate({ pattern, accountId, priority })}
          disabled={!pattern || !accountId}
        >
          Ajouter
        </button>
      </div>
      <div className="surface overflow-hidden">
        <div className="table-scroll">
          <table className="w-full text-sm">
            <thead className="text-left">
              <tr className="border-b border-ink-800/70">
                <th className="px-4 py-3 label font-normal">Motif</th>
                <th className="px-4 py-3 label font-normal">Compte</th>
                <th className="px-4 py-3 label font-normal">Priorité</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {patterns.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-ink-500 display-italic">
                    Aucun motif configuré.
                  </td>
                </tr>
              ) : (
                patterns.map((p) => (
                  <tr key={p.id} className="border-b border-ink-800/40 last:border-0">
                    <td className="px-4 py-2.5 text-ink-100 font-mono text-xs">{p.pattern}</td>
                    <td className="px-4 py-2.5 text-ink-300">{acctName(p.accountId)}</td>
                    <td className="px-4 py-2.5 text-ink-400 font-mono">{p.priority}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button className="text-[11px] text-ink-500 hover:text-clay-300" onClick={() => del.mutate(p.id)}>
                        supprimer
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
