import { useEffect, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useAccounts } from '../../lib/useReferenceData';
import { useTour } from '../../contexts/TourContext';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import type { Account } from '../../api/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useAutoStartTour } from '../../hooks/useAutoStartTour';
import { useTourAnchor } from '../../hooks/useTourAnchor';
import { TourReplayIcon } from '../../components/TourReplayIcon';
import { AccountCard } from './AccountCard';
import { AccountForm } from './AccountForm';
import { AccountPatternsPanel } from './AccountPatternsPanel';
import { MergeModal } from './MergeModal';
import { useAccountsReorder } from './useAccountsReorder';
import { useAccountsMutations } from './useAccountsMutations';
import { useAccountEdit } from './useAccountEdit';
import type { MergeResult } from '../../api/accounts';
import { ErrorState, LoadingBlock } from '../../components/StateBlocks';

export function Accounts() {
  const { t } = useTranslation(['accounts', 'common']);
  const qc = useQueryClient();
  const accountsQ = useAccounts();
  const [showForm, setShowForm] = useState(false);

  useAutoStartTour('accounts'); // no requireData — page exists to create data
  const addBtnAnchor = useTourAnchor('accounts:add-button');
  const startingBalAnchor = useTourAnchor('accounts:starting-balance');

  // Step 2 of the accounts tour points at the starting-balance field, which
  // only exists once AccountForm is mounted. Open the form when the tour
  // advances to that step; otherwise the anchor never registers and the
  // TourContext 2 s fallback silently finishes the tour.
  const { activePageId, stepIdx } = useTour();
  useEffect(() => {
    if (activePageId === 'accounts' && stepIdx === 1) setShowForm(true);
  }, [activePageId, stepIdx]);

  const m = useAccountsMutations();
  const edit = useAccountEdit(m.updateAccount, () => m.setEditError(null));

  const { sensors, onDragEnd } = useAccountsReorder(accountsQ.data ?? []);

  // One Set for expanded-drawer account ids. Rendering many cards at once, so a
  // Set keeps toggling O(log n) and avoids per-card boolean state.
  const [checkpointsOpen, setCheckpointsOpen] = useState<Set<number>>(new Set());
  const toggleCheckpoints = (id: number) =>
    setCheckpointsOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const [confirmDelete, setConfirmDelete] = useState<Account | null>(null);
  const [mergeSource, setMergeSource] = useState<Account | null>(null);

  return (
    <div className="flex flex-col gap-8">
      <div className="page-header">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="page-title">{t('title')}</h1>
            <TourReplayIcon pageId="accounts" />
          </div>
          <p className="page-subtitle">
            <Trans i18nKey="accounts:subtitle">
              <span className="display-italic">Current balance</span> = opening balance + sum of transactions since that date.
            </Trans>
          </p>
        </div>
        <button ref={addBtnAnchor} className="btn-primary" onClick={() => setShowForm((s) => !s)}>
          {showForm ? t('cancel', { ns: 'common' }) : t('newAccount')}
        </button>
      </div>

      {showForm && (
        <div ref={startingBalAnchor}>
          <AccountForm
            mode="create"
            error={m.error}
            submitting={m.create.isPending}
            onSubmit={(values) => {
              m.setError(null);
              m.create.mutate(values, { onSuccess: () => setShowForm(false) });
            }}
          />
        </div>
      )}

      <section>
        <div className="section-rule mb-4">{t('myAccounts')}</div>
        {accountsQ.isError ? (
          <ErrorState
            title={t('listErrorTitle')}
            error={accountsQ.error}
            onRetry={() => void accountsQ.refetch()}
          />
        ) : accountsQ.isLoading ? (
          <LoadingBlock height="min-h-40" />
        ) : (accountsQ.data ?? []).length === 0 ? (
          <div className="surface p-6 text-sm text-ink-400 display-italic">
            {t('emptyState')}
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={(accountsQ.data ?? []).map((a) => a.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {(accountsQ.data ?? []).map((a) => {
                  if (edit.editingId === a.id && edit.editDraft) {
                    return (
                      <div key={a.id} className="surface p-5 relative">
                        <div className="label mb-3">{t('editHeading')}</div>
                        <AccountForm
                          mode="edit"
                          initial={edit.editDraft}
                          error={m.editError}
                          submitting={m.updateAccount.isPending}
                          onSubmit={(values) => {
                            edit.setEditDraft(values);
                            edit.saveEdit(a, values);
                          }}
                          onCancel={edit.cancelEdit}
                          onDelete={() => {
                            m.setDeleteError(null);
                            setConfirmDelete(a);
                          }}
                        />
                        <AccountPatternsPanel accountId={a.id} />
                      </div>
                    );
                  }

                  return (
                    <AccountCard
                      key={a.id}
                      account={a}
                      onEdit={(acc) => edit.startEdit(acc)}
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
        title={
          confirmDelete
            ? t('deleteAccountDialog.title', { name: confirmDelete.name })
            : t('deleteAccountDialog.titleFallback')
        }
        description={
          <Trans i18nKey="accounts:deleteAccountDialog.description">
            Cette action est <span className="display-italic">irréversible</span>. Si le compte
            a déjà des transactions, le serveur refusera la suppression — déplacez ou supprimez
            d'abord les transactions concernées.
          </Trans>
        }
        confirmLabel={t('deleteAccountDialog.confirmLabel')}
        destructive
        busy={m.del.isPending}
        error={m.deleteError}
        onConfirm={() => {
          if (confirmDelete) m.del.mutate(confirmDelete.id, {
            onSuccess: () => {
              setConfirmDelete(null);
              edit.cancelEdit();
            },
          });
        }}
        onCancel={() => {
          setConfirmDelete(null);
          m.setDeleteError(null);
        }}
      />

      {mergeSource && (
        <MergeModal
          open
          source={mergeSource}
          candidates={accountsQ.data ?? []}
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
