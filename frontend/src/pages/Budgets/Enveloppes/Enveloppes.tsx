import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useEnvelopeReport, useUpsertAssignment, useReallocate, useUpsertHold, useUpsertSettings, useDeleteSettings } from '../../../lib/useEnvelopes';
import type { EnvelopeReportRow } from '../../../api/types';
import { PoolCard } from './PoolCard';
import { EnvelopeRow } from './EnvelopeRow';
import { AssignmentInput } from './AssignmentInput';
import { ReallocateModal } from './ReallocateModal';
import { HoldModal } from './HoldModal';
import { SettingsModal } from './SettingsModal';
import { UnbudgetedInline } from './UnbudgetedInline';

function currentMonthYm(): string {
  // Use client TZ; users see their local month, matching the transactions page.
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function stepMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y!, m! - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function Enveloppes(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const month = params.get('month') ?? currentMonthYm();
  const setMonth = (next: string) => {
    const p = new URLSearchParams(params);
    p.set('month', next);
    setParams(p, { replace: true });
  };

  const reportQ = useEnvelopeReport(month);
  const upsertAsg = useUpsertAssignment();
  const reallocate = useReallocate();
  const upsertHold = useUpsertHold();
  const upsertSettings = useUpsertSettings();
  const deleteSettings = useDeleteSettings();
  const [reallocSource, setReallocSource] = useState<EnvelopeReportRow | null>(null);
  const [holdOpen, setHoldOpen] = useState(false);
  const [settingsRow, setSettingsRow] = useState<EnvelopeReportRow | null>(null);

  const rows = reportQ.data?.rows ?? [];
  const pool = reportQ.data?.pool;

  const poolNegative = pool && Number(pool.available) < 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-4">
        <button className="btn-ghost !py-1 !px-2" onClick={() => setMonth(stepMonth(month, -1))} aria-label="Mois précédent">‹</button>
        <h1 className="display text-2xl">{formatMonthFrench(month)}</h1>
        <button className="btn-ghost !py-1 !px-2" onClick={() => setMonth(stepMonth(month, +1))} aria-label="Mois suivant">›</button>
      </header>

      {poolNegative && (
        <div className="surface p-4 border border-clay-500/60 text-clay-200">
          Vous avez sur-budgété de {formatSignedAbs(pool!.available)}. Réduisez des assignations ou ajoutez des revenus.
        </div>
      )}

      {pool && <PoolCard pool={pool} onHoldClick={() => setHoldOpen(true)} />}

      <section className="flex flex-col gap-2">
        <div className="label px-2">Enveloppes</div>
        {rows.length === 0 && reportQ.isSuccess && (
          <div className="surface p-6 text-center flex flex-col gap-3">
            <div className="display text-lg">Aucune enveloppe pour ce mois</div>
            <div className="text-sm text-ink-400">
              Créez votre première enveloppe pour commencer.
            </div>
          </div>
        )}
        {rows.map((row) => (
          <EnvelopeRow
            key={row.categoryId}
            row={row}
            assignmentSlot={
              <AssignmentInput
                value={row.assignment}
                onCommit={(nextAmount) =>
                  upsertAsg.mutate({ categoryId: row.categoryId, month, amount: nextAmount })
                }
              />
            }
            onReallocateClick={(row) => setReallocSource(row)}
            onSettingsClick={(row) => setSettingsRow(row)}
          />
        ))}
      </section>

      {rows.some((r) => Number(r.spend) > 0 && Number(r.assignment) === 0 && Number(r.balancePriorMonth) === 0) && (
        <UnbudgetedInline
          rows={rows.filter((r) =>
            Number(r.spend) > 0 &&
            Number(r.assignment) === 0 &&
            Number(r.balancePriorMonth) === 0
          )}
          onCreate={(categoryId, suggestedAmount) =>
            upsertAsg.mutate({ categoryId, month, amount: suggestedAmount })
          }
        />
      )}

      <ReallocateModal
        open={!!reallocSource}
        source={reallocSource}
        rows={rows}
        month={month}
        onClose={() => setReallocSource(null)}
        onConfirm={(payload) => { reallocate.mutate(payload); setReallocSource(null); }}
      />

      <HoldModal
        open={holdOpen}
        month={month}
        poolAvailable={pool?.available ?? '0.00'}
        onClose={() => setHoldOpen(false)}
        onConfirm={(payload) => { upsertHold.mutate(payload); setHoldOpen(false); }}
      />

      <SettingsModal
        open={!!settingsRow}
        row={settingsRow}
        onClose={() => setSettingsRow(null)}
        onSave={(args) => { upsertSettings.mutate(args); setSettingsRow(null); }}
        onDeleteTarget={(categoryId) => { deleteSettings.mutate(categoryId); setSettingsRow(null); }}
      />
    </div>
  );
}

function formatMonthFrench(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y!, m! - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}
function formatSignedAbs(m: string): string {
  const n = Math.abs(Number(m));
  return n.toFixed(2).replace('.', ',') + ' €';
}
