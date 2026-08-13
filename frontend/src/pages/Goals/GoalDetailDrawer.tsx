import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  closeGoal, createGoalEvent, deleteGoal, deleteGoalEvent,
  listGoalEvents, reopenGoal, updateGoal,
} from '../../api/goals';
import type { Account, SavingsGoal } from '../../api/types';
import { parseDecimal } from '../../lib/format';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { GoalForm } from './GoalForm';
import { EventRow } from './EventRow';

// Right-side drawer for a single goal. Two views: an event log with an
// "Ajouter/Retirer" form and a header showing name/target/status; a "Modifier"
// button flips the header into the shared GoalForm. Delete is guarded by
// ConfirmDialog. Kept under 300 lines by delegating the form + event row to
// their own components.
export function GoalDetailDrawer({
  goal,
  accounts,
  onClose,
  onReached,
}: {
  goal: SavingsGoal;
  accounts: Account[];
  onClose: () => void;
  onReached?: () => void;
}) {
  const { t } = useTranslation('goals');
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDeleteEvent, setConfirmDeleteEvent] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const eventsQ = useQuery({
    queryKey: ['goal-events', goal.id],
    queryFn: () => listGoalEvents(goal.id, { limit: 50 }),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['goals'] });
    qc.invalidateQueries({ queryKey: ['goal-events', goal.id] });
  };

  const updateMut = useMutation({
    mutationFn: (v: {
      accountId: number; name: string; targetAmount: string;
      targetDate: string | null; color: string | null;
    }) => updateGoal(goal.id, {
      name: v.name, targetAmount: v.targetAmount,
      targetDate: v.targetDate, color: v.color,
    }),
    onSuccess: () => { setEditing(false); setFormError(null); invalidate(); },
    onError: (err) => setFormError(err instanceof Error ? err.message : String(err)),
  });

  const closeMut = useMutation({
    mutationFn: () => closeGoal(goal.id),
    onSuccess: invalidate,
  });
  const reopenMut = useMutation({
    mutationFn: () => reopenGoal(goal.id),
    onSuccess: invalidate,
  });
  const deleteMut = useMutation({
    mutationFn: () => deleteGoal(goal.id),
    onSuccess: () => { invalidate(); onClose(); },
  });

  const [amountRaw, setAmountRaw] = useState('');
  const [eventDate, setEventDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [eventNote, setEventNote] = useState('');

  const addEventMut = useMutation({
    mutationFn: () => {
      const amt = parseDecimal(amountRaw);
      if (!amt || Number(amt) === 0) throw new Error('invalid amount');
      return createGoalEvent(goal.id, { amount: amt, eventDate, note: eventNote || null });
    },
    onSuccess: (res) => {
      setAmountRaw(''); setEventNote('');
      invalidate();
      if (res.justReached) onReached?.();
    },
  });

  const deleteEventMut = useMutation({
    mutationFn: (id: number) => deleteGoalEvent(goal.id, id),
    onSuccess: () => { setConfirmDeleteEvent(null); invalidate(); },
  });

  if (editing) {
    return (
      <div className="surface p-4">
        <div className="display text-sm text-ink-100 mb-3">{t('form.editTitle')}</div>
        <GoalForm
          accounts={accounts}
          initial={goal}
          submitting={updateMut.isPending}
          serverError={formError}
          onSubmit={(v) => updateMut.mutate(v)}
          onCancel={() => { setEditing(false); setFormError(null); }}
        />
      </div>
    );
  }

  return (
    <div className="surface p-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-ink-100">{goal.name}</div>
          {goal.closedAt && (
            <div className="text-[11px] text-ink-500 mt-0.5">
              {t('drawer.closeButton')}
            </div>
          )}
        </div>
        <div className="flex gap-1">
          <button type="button" className="btn-secondary text-xs" onClick={() => setEditing(true)}>
            {t('form.editTitle')}
          </button>
          {goal.closedAt ? (
            <button type="button" className="btn-secondary text-xs" onClick={() => reopenMut.mutate()}>
              {t('drawer.reopenButton')}
            </button>
          ) : (
            <button type="button" className="btn-secondary text-xs" onClick={() => closeMut.mutate()}>
              {t('drawer.closeButton')}
            </button>
          )}
        </div>
      </div>

      {!goal.closedAt && (
        <form
          onSubmit={(e) => { e.preventDefault(); if (amountRaw.trim()) addEventMut.mutate(); }}
          className="space-y-2 border-t border-ink-800/60 pt-3"
        >
          <div className="text-xs text-ink-400">{t('events.addTitle')}</div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[120px]">
              <label className="label block mb-0.5">{t('events.amountLabel')}</label>
              <input
                type="text"
                inputMode="decimal"
                className="input w-full tabular-nums"
                value={amountRaw}
                placeholder={t('events.amountPlaceholder')}
                onChange={(e) => setAmountRaw(e.target.value)}
              />
            </div>
            <div>
              <label className="label block mb-0.5">{t('events.dateLabel')}</label>
              <input
                type="date"
                className="input"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="label block mb-0.5">{t('events.noteLabel')}</label>
            <input
              type="text"
              className="input w-full"
              value={eventNote}
              onChange={(e) => setEventNote(e.target.value)}
              maxLength={200}
            />
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              className="btn-primary text-xs"
              disabled={addEventMut.isPending || !amountRaw.trim()}
            >
              {t('events.submit')}
            </button>
          </div>
        </form>
      )}

      <div className="border-t border-ink-800/60 pt-3">
        <div className="text-xs text-ink-400 mb-2">{t('drawer.recentActivity')}</div>
        {eventsQ.data?.events.length === 0 && (
          <div className="text-xs text-ink-600">{t('drawer.noEvents')}</div>
        )}
        {eventsQ.data?.events.map((ev) => (
          <EventRow
            key={ev.id}
            event={ev}
            currency={goal.currency}
            onDelete={setConfirmDeleteEvent}
          />
        ))}
      </div>

      <div className="border-t border-ink-800/60 pt-3 flex justify-end">
        <button
          type="button"
          className="text-xs text-clay-300 hover:text-clay-200"
          onClick={() => setConfirmDelete(true)}
        >
          {t('drawer.deleteButton')}
        </button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={t('drawer.deleteConfirmTitle')}
        description={t('drawer.deleteConfirmDescription')}
        destructive
        busy={deleteMut.isPending}
        onConfirm={() => deleteMut.mutate()}
        onCancel={() => setConfirmDelete(false)}
      />

      <ConfirmDialog
        open={confirmDeleteEvent !== null}
        title={t('events.confirmDeleteTitle')}
        description={t('events.confirmDeleteDescription')}
        destructive
        busy={deleteEventMut.isPending}
        onConfirm={() => { if (confirmDeleteEvent) deleteEventMut.mutate(confirmDeleteEvent); }}
        onCancel={() => setConfirmDeleteEvent(null)}
      />
    </div>
  );
}
