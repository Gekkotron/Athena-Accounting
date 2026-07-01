import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { Account, AccountFilenamePattern } from '../../api/types';
import { formatAmount, formatDate, amountSignClass } from '../../lib/format';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { PatternsSection } from './PatternsSection';
import { BalanceCheckpointsDrawer } from './BalanceCheckpointsDrawer';

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

  const updateAccount = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<Account> }) =>
      api<{ account: Account }>(`/api/accounts/${id}`, { method: 'PUT', json: patch }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      setEditingId(null);
    },
    onError: (err: ApiError) => setEditError(err.message),
  });

  const reorder = useMutation({
    mutationFn: (ids: number[]) =>
      api('/api/accounts/order', { method: 'PUT', json: { ids } }),
    onMutate: async (ids) => {
      // Optimistic update: rewrite the cached order immediately so the cards
      // don't snap back-and-forth while the PUT round-trips.
      await qc.cancelQueries({ queryKey: ['accounts'] });
      const previous = qc.getQueryData<{ accounts: Account[] }>(['accounts']);
      if (previous) {
        const byId = new Map(previous.accounts.map((a) => [a.id, a] as const));
        const reordered = ids.map((id) => byId.get(id)).filter((a): a is Account => !!a);
        qc.setQueryData(['accounts'], { accounts: reordered });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(['accounts'], context.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
  });

  const move = (id: number, dir: -1 | 1) => {
    const list = accountsQ.data?.accounts ?? [];
    const idx = list.findIndex((a) => a.id === id);
    if (idx < 0) return;
    const target = idx + dir;
    if (target < 0 || target >= list.length) return;
    const next = list.slice();
    const [moved] = next.splice(idx, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    reorder.mutate(next.map((a) => a.id));
  };

  // One Set for expanded-drawer account ids. Rendering many cards at once, so a
  // Set keeps toggling O(log n) and avoids per-card boolean state.
  const [checkpointsOpen, setCheckpointsOpen] = useState<Set<number>>(new Set());
  const toggleCheckpoints = (id: number) =>
    setCheckpointsOpen((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const [confirmDelete, setConfirmDelete] = useState<Account | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const del = useMutation({
    mutationFn: (id: number) => api(`/api/accounts/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      setConfirmDelete(null);
      setDeleteError(null);
      cancelEdit();
    },
    onError: (err: ApiError) => {
      // Backend returns 409 with a clear message when the account has
      // transactions; surface that text inside the dialog instead of letting
      // the dialog close silently.
      setDeleteError(err.message);
    },
  });

  // Per-card edit state. Only one account can be in edit mode at a time; the
  // draft is local so cancelling discards the in-flight changes cleanly.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<{
    name: string;
    type: string;
    currency: string;
    openingBalance: string;
    openingDate: string;
  } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const startEdit = (a: Account) => {
    setEditError(null);
    setEditingId(a.id);
    setEditDraft({
      name: a.name,
      type: a.type,
      currency: a.currency,
      openingBalance: a.openingBalance,
      openingDate: a.openingDate,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft(null);
    setEditError(null);
  };

  const saveEdit = (a: Account) => {
    if (!editDraft) return;
    const patch: Partial<Account> = {};
    if (editDraft.name !== a.name) patch.name = editDraft.name.trim();
    if (editDraft.type !== a.type) patch.type = editDraft.type;
    if (editDraft.currency !== a.currency) patch.currency = editDraft.currency.toUpperCase();
    if (editDraft.openingBalance !== a.openingBalance) patch.openingBalance = editDraft.openingBalance;
    if (editDraft.openingDate !== a.openingDate) patch.openingDate = editDraft.openingDate;
    if (Object.keys(patch).length === 0) {
      cancelEdit();
      return;
    }
    setEditError(null);
    updateAccount.mutate({ id: a.id, patch });
  };

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
            {(accountsQ.data?.accounts ?? []).map((a, idx, arr) => {
              if (editingId === a.id && editDraft) {
                return (
                  <div key={a.id} className="surface p-5 relative">
                    <div className="label mb-3">Éditer le compte</div>
                    <div className="flex flex-col gap-3">
                      <div>
                        <label className="label mb-1 block">Nom</label>
                        <input
                          className="input"
                          value={editDraft.name}
                          onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="label mb-1 block">Type</label>
                          <select
                            className="input"
                            value={editDraft.type}
                            onChange={(e) => setEditDraft({ ...editDraft, type: e.target.value })}
                          >
                            <option value="checking">Courant</option>
                            <option value="savings">Épargne</option>
                            <option value="credit">Crédit</option>
                            <option value="other">Autre</option>
                          </select>
                        </div>
                        <div>
                          <label className="label mb-1 block">Devise</label>
                          <input
                            className="input"
                            value={editDraft.currency}
                            onChange={(e) =>
                              setEditDraft({ ...editDraft, currency: e.target.value.toUpperCase() })
                            }
                            maxLength={3}
                          />
                        </div>
                      </div>
                      <div>
                        <label className="label mb-1 block">Solde d'ouverture</label>
                        <input
                          className="input font-mono"
                          value={editDraft.openingBalance}
                          onChange={(e) =>
                            setEditDraft({ ...editDraft, openingBalance: e.target.value })
                          }
                        />
                        <div className="text-[11px] text-ink-500 mt-1">
                          Modifier ce montant ajustera automatiquement le solde courant.
                        </div>
                      </div>
                      <div>
                        <label className="label mb-1 block">Date d'ouverture</label>
                        <input
                          type="date"
                          className="input"
                          value={editDraft.openingDate}
                          onChange={(e) =>
                            setEditDraft({ ...editDraft, openingDate: e.target.value })
                          }
                        />
                      </div>
                      {editError && (
                        <div className="rounded-md border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-xs text-clay-200">
                          {editError}
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-2 pt-1">
                        <button
                          className="text-[11px] text-clay-300 hover:text-clay-200 transition"
                          onClick={() => {
                            setDeleteError(null);
                            setConfirmDelete(a);
                          }}
                        >
                          supprimer
                        </button>
                        <div className="flex gap-2">
                          <button className="btn-ghost" onClick={cancelEdit}>
                            Annuler
                          </button>
                          <button
                            className="btn-primary"
                            onClick={() => saveEdit(a)}
                            disabled={updateAccount.isPending}
                          >
                            {updateAccount.isPending ? 'Enregistrement…' : 'Enregistrer'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div key={a.id} className="surface p-5 relative group">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="text-sm font-medium text-ink-100 truncate">{a.name}</div>
                    <span className="badge">{a.currency}</span>
                  </div>
                  <div className="label mt-0.5">{a.type}</div>
                  <div className={`display mt-4 text-3xl tabular-nums ${amountSignClass(a.currentBalance ?? '0')}`}>
                    {formatAmount(a.currentBalance ?? '0', a.currency)}
                  </div>
                  <div className="text-[11px] text-ink-500 mt-3 font-mono leading-relaxed">
                    ouvert {formatDate(a.openingDate)} ·{' '}
                    <span className="private">{formatAmount(a.openingBalance, a.currency)}</span>
                  </div>
                  {/* Top-right cluster: reorder up/down + modify */}
                  <div className="absolute top-3 right-3 flex items-center gap-1">
                    <button
                      className="p-1 rounded text-ink-600 hover:text-ink-100 hover:bg-ink-900 transition disabled:opacity-30 disabled:hover:text-ink-600 disabled:hover:bg-transparent"
                      onClick={() => move(a.id, -1)}
                      disabled={idx === 0 || reorder.isPending}
                      title="Monter"
                      aria-label="Déplacer vers le haut"
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                        <path d="M3 7l3-3 3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <button
                      className="p-1 rounded text-ink-600 hover:text-ink-100 hover:bg-ink-900 transition disabled:opacity-30 disabled:hover:text-ink-600 disabled:hover:bg-transparent"
                      onClick={() => move(a.id, 1)}
                      disabled={idx === arr.length - 1 || reorder.isPending}
                      title="Descendre"
                      aria-label="Déplacer vers le bas"
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                        <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <button
                      className="ml-1 inline-flex items-center gap-1 text-[11px] text-ink-500 hover:text-ink-100 transition"
                      onClick={() => startEdit(a)}
                      title="Modifier"
                    >
                      <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
                        <path d="M2 7.5l5-5 1.5 1.5-5 5L2 9.5V7.5z" stroke="currentColor" strokeWidth="0.8" strokeLinejoin="round" />
                      </svg>
                      modifier
                    </button>
                  </div>
                  <div className="mt-3 pt-3 border-t border-ink-800/60">
                    <button
                      type="button"
                      className="flex items-center gap-1 text-[11px] text-ink-500 hover:text-ink-100 transition"
                      onClick={() => toggleCheckpoints(a.id)}
                      aria-expanded={checkpointsOpen.has(a.id)}
                    >
                      <span className={`inline-block transition-transform ${checkpointsOpen.has(a.id) ? 'rotate-90' : ''}`}>▸</span>
                      Points de contrôle
                    </button>
                    {checkpointsOpen.has(a.id) && (
                      <BalanceCheckpointsDrawer accountId={a.id} currency={a.currency} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <PatternsSection patterns={patternsQ.data?.patterns ?? []} accounts={accountsQ.data?.accounts ?? []} />

      <ConfirmDialog
        open={!!confirmDelete}
        title={confirmDelete ? `Supprimer « ${confirmDelete.name} » ?` : 'Supprimer ?'}
        description={
          <>
            Cette action est <span className="display-italic">irréversible</span>. Si le compte
            a déjà des transactions, le serveur refusera la suppression — déplacez ou supprimez
            d'abord les transactions concernées.
          </>
        }
        confirmLabel="Supprimer le compte"
        destructive
        busy={del.isPending}
        error={deleteError}
        onConfirm={() => {
          if (confirmDelete) del.mutate(confirmDelete.id);
        }}
        onCancel={() => {
          setConfirmDelete(null);
          setDeleteError(null);
        }}
      />
    </div>
  );
}
