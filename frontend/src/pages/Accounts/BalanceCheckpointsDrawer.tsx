import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api/client';
import { listCheckpoints, createCheckpoint, updateCheckpoint, deleteCheckpoint } from '../../api/checkpoints';
import type { BalanceCheckpoint } from '../../api/types';
import { CheckpointRow } from './CheckpointRow';

// Translate a checkpoint-endpoint error into an actionable French sentence.
// The backend returns 409 for date collisions and 400 with a Zod `issues`
// array for validation failures (e.g. non-decimal amount, note over 200
// chars). Without this helper, users see "invalid input" — technically
// accurate, useless in practice.
type ZodIssue = { path: (string | number)[]; message?: string };

function friendlyCheckpointError(err: unknown, action: 'ajout' | 'mise à jour' | 'suppression'): string {
  if (err instanceof ApiError) {
    if (err.status === 409) {
      // Only conflict we produce is the (account, date) unique index.
      return 'Un point de contrôle existe déjà à cette date sur ce compte.';
    }
    if (err.status === 400) {
      const issues = (err.data as { issues?: ZodIssue[] } | null | undefined)?.issues;
      const first = issues?.[0];
      const field = typeof first?.path?.[0] === 'string' ? (first!.path[0] as string) : undefined;
      if (field === 'checkpointDate') return 'Date invalide (format attendu : AAAA-MM-JJ).';
      if (field === 'expectedAmount') return 'Montant invalide (nombre à 2 décimales max, ex. 1234.56).';
      if (field === 'note') return 'Note trop longue (200 caractères max).';
      return 'Champs invalides — vérifiez la date, le montant et la note.';
    }
    if (err.status === 404) {
      return `${capitalise(action)} impossible : le point de contrôle est introuvable (déjà supprimé ?).`;
    }
    if (err.status === 401) {
      return 'Session expirée — reconnectez-vous.';
    }
  }
  const message = err instanceof Error ? err.message : 'erreur réseau';
  return `${capitalise(action)} impossible : ${message}.`;
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
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['balance-checkpoints', accountId],
    queryFn: () => listCheckpoints(accountId),
  });

  const [newDate, setNewDate] = useState(new Date().toISOString().slice(0, 10));
  const [newAmount, setNewAmount] = useState('');
  const [newNote, setNewNote] = useState('');
  const [mutationError, setMutationError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      createCheckpoint(accountId, {
        checkpointDate: newDate,
        expectedAmount: newAmount,
        note: newNote || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['balance-checkpoints', accountId] });
      setNewAmount('');
      setNewNote('');
      setMutationError(null);
    },
    onError: (err: unknown) => setMutationError(friendlyCheckpointError(err, 'ajout')),
  });

  const del = useMutation({
    mutationFn: (cpId: number) => deleteCheckpoint(accountId, cpId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['balance-checkpoints', accountId] });
      setMutationError(null);
    },
    onError: (err: unknown) => setMutationError(friendlyCheckpointError(err, 'suppression')),
  });

  const patch = useMutation({
    mutationFn: (args: { cpId: number; patch: { expectedAmount?: string; note?: string | null } }) =>
      updateCheckpoint(accountId, args.cpId, args.patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['balance-checkpoints', accountId] });
      setMutationError(null);
    },
    onError: (err: unknown) => setMutationError(friendlyCheckpointError(err, 'mise à jour')),
  });

  const rows = q.data?.checkpoints ?? [];
  const groups = useMemo(() => groupByYear(rows), [rows]);
  const mostRecentYear = groups[0]?.year;

  return (
    <div className="mt-2">
      {rows.length === 0 && !q.isLoading && (
        <div className="text-[11px] text-ink-500 italic mb-2">
          Aucun point de contrôle. Ajoutez-en un pour vérifier vos soldes contre un relevé.
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
          aria-label="Date du point de contrôle"
        />
        <input
          type="text"
          inputMode="decimal"
          className="input-sm w-28 text-right"
          placeholder="0.00"
          value={newAmount}
          onChange={(e) => setNewAmount(e.target.value)}
          aria-label="Montant attendu"
        />
        <input
          type="text"
          className="input-sm flex-1 min-w-[8rem]"
          placeholder="note (optionnelle)"
          maxLength={200}
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          aria-label="Note"
        />
        <button
          type="button"
          className="btn-sm"
          disabled={!newAmount || create.isPending}
          onClick={() => create.mutate()}
        >
          + ajouter
        </button>
      </div>
      {mutationError && (
        <div className="mt-1 text-[11px] text-clay-300">{mutationError}</div>
      )}
    </div>
  );
}
