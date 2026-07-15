import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  arrayMove,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { api, ApiError } from '../../api/client';
import type { Account } from '../../api/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { AccountCard } from './AccountCard';
import { AccountForm, type AccountFormValues } from './AccountForm';
import { MergeModal } from './MergeModal';
import type { MergeResult } from '../../api/accounts';

export function Accounts() {
  const qc = useQueryClient();
  const accountsQ = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api<{ accounts: Account[] }>('/api/accounts'),
  });
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (input: AccountFormValues) =>
      api<{ account: Account }>('/api/accounts', { method: 'POST', json: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      setShowForm(false);
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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const list = accountsQ.data?.accounts ?? [];
    const oldIndex = list.findIndex((a) => a.id === active.id);
    const newIndex = list.findIndex((a) => a.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(list, oldIndex, newIndex);
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
  const [mergeSource, setMergeSource] = useState<Account | null>(null);

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
    lockYears: number | null;
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
      lockYears: a.lockYears ?? null,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft(null);
    setEditError(null);
  };

  // `draft` is passed explicitly (not read from editDraft state) because
  // setEditDraft(values) hasn't re-rendered yet when saveEdit runs in the
  // same event handler tick. Characterization test #3 is the safety net.
  const saveEdit = (a: Account, draft: typeof editDraft) => {
    if (!draft) return;
    const patch: Partial<Account> = {};
    if (draft.name !== a.name) patch.name = draft.name.trim();
    if (draft.type !== a.type) patch.type = draft.type;
    if (draft.currency !== a.currency) patch.currency = draft.currency.toUpperCase();
    if (draft.openingBalance !== a.openingBalance) patch.openingBalance = draft.openingBalance;
    if (draft.openingDate !== a.openingDate) patch.openingDate = draft.openingDate;
    if ((draft.lockYears ?? null) !== (a.lockYears ?? null)) patch.lockYears = draft.lockYears;
    if (Object.keys(patch).length === 0) {
      cancelEdit();
      return;
    }
    setEditError(null);
    updateAccount.mutate({ id: a.id, patch });
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
        <AccountForm
          mode="create"
          error={error}
          submitting={create.isPending}
          onSubmit={(values) => {
            setError(null);
            create.mutate(values);
          }}
        />
      )}

      <section>
        <div className="section-rule mb-4">Mes comptes</div>
        {(accountsQ.data?.accounts ?? []).length === 0 ? (
          <div className="surface p-6 text-sm text-ink-400 display-italic">
            Aucun compte pour l'instant.
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={(accountsQ.data?.accounts ?? []).map((a) => a.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {(accountsQ.data?.accounts ?? []).map((a) => {
                  if (editingId === a.id && editDraft) {
                    return (
                      <div key={a.id} className="surface p-5 relative">
                        <div className="label mb-3">Éditer le compte</div>
                        <AccountForm
                          mode="edit"
                          initial={editDraft}
                          error={editError}
                          submitting={updateAccount.isPending}
                          onSubmit={(values) => {
                            setEditDraft(values);
                            saveEdit(a, values);
                          }}
                          onCancel={cancelEdit}
                          onDelete={() => {
                            setDeleteError(null);
                            setConfirmDelete(a);
                          }}
                        />
                      </div>
                    );
                  }

                  return (
                    <AccountCard
                      key={a.id}
                      account={a}
                      onEdit={(acc) => startEdit(acc)}
                      onMerge={setMergeSource}
                      onExpand={(id) => toggleCheckpoints(id)}
                      expanded={checkpointsOpen.has(a.id)}
                    />
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </section>

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

      {mergeSource && (
        <MergeModal
          open
          source={mergeSource}
          candidates={accountsQ.data?.accounts ?? []}
          onCancel={() => setMergeSource(null)}
          onDone={(result: MergeResult) => {
            setMergeSource(null);
            void qc.invalidateQueries({ queryKey: ['accounts'] });
            void qc.invalidateQueries({ queryKey: ['reports'] });
            void qc.invalidateQueries({ queryKey: ['transactions'] });
            console.info(
              `Fusion réussie : ${result.transactionsMoved} transactions déplacées, ` +
              `${result.dedupCollisionsDropped} doublons ignorés, ` +
              `solde d'ouverture ajouté ${result.openingBalanceAdded}.`,
            );
          }}
        />
      )}
    </div>
  );
}
