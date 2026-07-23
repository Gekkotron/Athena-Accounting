import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api/client';
import { listCheckpoints, createCheckpoint, updateCheckpoint, deleteCheckpoint } from '../../api/checkpoints';
import type { BalanceCheckpoint } from '../../api/types';
import { parseDecimal } from '../../lib/format';
import { CheckpointRow } from './CheckpointRow';

// Translate a checkpoint-endpoint error into an actionable, localized
// sentence. The backend returns 409 for date collisions and 400 with a Zod
// `issues` array for validation failures (e.g. non-decimal amount, note over
// 200 chars). Without this helper, users see "invalid input" — technically
// accurate, useless in practice. `t` is passed in from the calling
// component's `useTranslation('accounts')` since this function lives outside
// component/hook scope.
type ZodIssue = { path: (string | number)[]; message?: string };
type CheckpointAction = 'add' | 'update' | 'delete';
type Translate = (key: string, opts?: Record<string, unknown>) => string;

function friendlyCheckpointError(err: unknown, action: CheckpointAction, t: Translate): string {
  if (err instanceof ApiError) {
    if (err.status === 409) {
      // Only conflict we produce is the (account, date) unique index.
      return t('checkpoints.errors.duplicateDate');
    }
    if (err.status === 400) {
      const issues = (err.data as { issues?: ZodIssue[] } | null | undefined)?.issues;
      const first = issues?.[0];
      const field = typeof first?.path?.[0] === 'string' ? (first!.path[0] as string) : undefined;
      if (field === 'checkpointDate') return t('checkpoints.errors.invalidDate');
      if (field === 'expectedAmount') return t('checkpoints.errors.invalidAmount');
      if (field === 'note') return t('checkpoints.errors.noteTooLong');
      return t('checkpoints.errors.invalidFields');
    }
    if (err.status === 404) {
      return t('checkpoints.errors.notFound', { action: capitalise(t(`checkpoints.actions.${action}`)) });
    }
    if (err.status === 401) {
      return t('checkpoints.errors.sessionExpired');
    }
  }
  const message = err instanceof Error ? err.message : t('checkpoints.errors.networkError');
  return t('checkpoints.errors.generic', { action: capitalise(t(`checkpoints.actions.${action}`)), message });
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Group checkpoints by ISO-year (`checkpointDate.slice(0,4)`), keep them
// date-descending inside each group, and return year buckets ordered from
// most-recent to oldest. The API returns oldest-first — we invert here so
// the freshly-imported statements land at the top of the drawer.
function groupByYear(rows: BalanceCheckpoint[]): Array<{ year: string; items: BalanceCheckpoint[] }> {
  const buckets = new Map<string, BalanceCheckpoint[]>();
  for (const r of rows) {
    const y = r.checkpointDate.slice(0, 4);
    const arr = buckets.get(y) ?? [];
    arr.push(r);
    buckets.set(y, arr);
  }
  return Array.from(buckets.entries())
    .map(([year, items]) => ({
      year,
      items: [...items].sort((a, b) => b.checkpointDate.localeCompare(a.checkpointDate)),
    }))
    .sort((a, b) => b.year.localeCompare(a.year));
}

export function BalanceCheckpointsDrawer({ accountId, currency }: { accountId: number; currency: string }) {
  const { t } = useTranslation('accounts');
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['balance-checkpoints', accountId],
    queryFn: () => listCheckpoints(accountId),
  });

  const [newDate, setNewDate] = useState(new Date().toISOString().slice(0, 10));
  const [newAmount, setNewAmount] = useState('');
  const [newNote, setNewNote] = useState('');
  const [mutationError, setMutationError] = useState<string | null>(null);

  // Normalize the typed amount to the backend's decimal contract before
  // POSTing. Without this the natural French "1500,00" hits the zod regex
  // `^-?\d+(\.\d{1,2})?$` and comes back as a generic 400.
  const parsedNewAmount = parseDecimal(newAmount);

  const create = useMutation({
    mutationFn: () => {
      if (parsedNewAmount == null) {
        throw new ApiError(t('checkpoints.errors.invalidAmount'), 400, null);
      }
      return createCheckpoint(accountId, {
        checkpointDate: newDate,
        expectedAmount: parsedNewAmount,
        note: newNote || undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['balance-checkpoints', accountId] });
      setNewAmount('');
      setNewNote('');
      setMutationError(null);
    },
    onError: (err: unknown) => setMutationError(friendlyCheckpointError(err, 'add', t)),
  });

  const del = useMutation({
    mutationFn: (cpId: number) => deleteCheckpoint(accountId, cpId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['balance-checkpoints', accountId] });
      setMutationError(null);
    },
    onError: (err: unknown) => setMutationError(friendlyCheckpointError(err, 'delete', t)),
  });

  const patch = useMutation({
    mutationFn: (args: { cpId: number; patch: { expectedAmount?: string; note?: string | null } }) =>
      updateCheckpoint(accountId, args.cpId, args.patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['balance-checkpoints', accountId] });
      setMutationError(null);
    },
    onError: (err: unknown) => setMutationError(friendlyCheckpointError(err, 'update', t)),
  });

  const rows = q.data?.checkpoints ?? [];
  const groups = useMemo(() => groupByYear(rows), [rows]);
  const mostRecentYear = groups[0]?.year;

  return (
    <div className="mt-2">
      {rows.length === 0 && !q.isLoading && (
        <div className="text-[11px] text-ink-500 italic mb-2">
          {t('checkpoints.emptyState')}
        </div>
      )}

      {/* Chronological accordion — one <details> per year, most-recent open
          by default. Uses the native disclosure element so keyboard/screen-
          reader accessibility comes for free; content stays in the DOM when
          closed (so existing text-based tests keep working). */}
      {groups.map(({ year, items }) => (
        <details
          key={year}
          open={year === mostRecentYear}
          className="mb-1 group"
        >
          <summary className="list-none cursor-pointer select-none flex items-center gap-1.5 text-[11px] text-ink-500 hover:text-ink-300 py-1">
            <span
              aria-hidden
              className="inline-block w-3 transition-transform group-open:rotate-90"
            >
              ▸
            </span>
            <span className="font-mono text-ink-300">{year}</span>
            <span className="text-ink-700">({items.length})</span>
          </summary>
          <table className="w-full text-[11px] font-mono">
            <tbody>
              {items.map((c) => (
                <CheckpointRow
                  key={c.id}
                  cp={c}
                  currency={currency}
                  onSave={(p) => patch.mutate({ cpId: c.id, patch: p })}
                  onDelete={() => del.mutate(c.id)}
                  saving={patch.isPending}
                  deleting={del.isPending}
                />
              ))}
            </tbody>
          </table>
        </details>
      ))}

      <div className="flex flex-wrap items-center gap-2 mt-2">
        <input
          type="date"
          className="input-sm w-36"
          value={newDate}
          onChange={(e) => setNewDate(e.target.value)}
          aria-label={t('checkpoints.dateInputLabel')}
        />
        <input
          type="text"
          inputMode="decimal"
          className="input-sm w-28 text-right"
          placeholder="0.00"
          value={newAmount}
          onChange={(e) => setNewAmount(e.target.value)}
          aria-label={t('checkpoints.amountInputLabel')}
        />
        <input
          type="text"
          className="input-sm flex-1 min-w-[8rem]"
          placeholder={t('checkpoints.notePlaceholder')}
          maxLength={200}
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          aria-label={t('checkpoints.noteInputLabel')}
        />
        <button
          type="button"
          className="btn-sm"
          disabled={parsedNewAmount == null || create.isPending}
          onClick={() => create.mutate()}
        >
          {t('checkpoints.addButton')}
        </button>
      </div>
      {mutationError && (
        <div className="mt-1 text-[11px] text-clay-300">{mutationError}</div>
      )}
    </div>
  );
}
