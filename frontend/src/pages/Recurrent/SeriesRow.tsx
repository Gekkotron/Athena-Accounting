import type { RecurringEssentialness, RecurringSeries, RecurringStatus } from '../../api/types';
import { amountSignClass, formatAmount, formatDate } from '../../lib/format';
import { cadenceLabel } from './lib';

interface UpdatePatch {
  status?: RecurringStatus;
  essentialness?: RecurringEssentialness | null;
}

// The latest occurrence moved ≥10% and ≥2€ against the trailing average
// (computed server-side). Amounts render as magnitudes — the row's sign
// coloring already says whether this is an expense or income series.
function PriceCreepChip({ creep }: { creep: NonNullable<RecurringSeries['priceCreep']> }): JSX.Element {
  const up = creep.deltaPct > 0;
  const pct = `${up ? '+' : '−'}${Math.abs(Math.round(creep.deltaPct))} %`;
  return (
    <span
      className={`inline-flex items-center gap-1 mt-1 w-fit text-[11px] rounded-full px-2 py-[1px] border ${
        up
          ? 'text-clay-200 border-clay-800/60 bg-clay-900/25'
          : 'text-sage-300 border-sage-800/60 bg-sage-900/20'
      }`}
    >
      {up ? 'Prix en hausse' : 'Prix en baisse'} :{' '}
      {formatAmount(Math.abs(creep.previousAvg))} → {formatAmount(Math.abs(creep.latest))} ({pct})
    </span>
  );
}

export function SeriesRow({
  row, onUpdate,
}: {
  row: RecurringSeries;
  onUpdate: (patch: UpdatePatch) => void;
}): JSX.Element {
  const isConfirmed = row.status === 'confirmed';
  const essentialness = row.essentialness;

  const cycleEssentialness = () => {
    if (essentialness === 'essential') onUpdate({ essentialness: 'discretionary' });
    else if (essentialness === 'discretionary') onUpdate({ essentialness: null });
    else onUpdate({ essentialness: 'essential' });
  };

  const essentialnessLabel =
    essentialness === 'essential' ? 'Essentiel'
      : essentialness === 'discretionary' ? 'Discrétionnaire'
      : 'Marquer';
  const essentialnessTitle =
    essentialness === 'essential' ? 'Marqué comme essentiel. Cliquer pour passer en discrétionnaire.'
      : essentialness === 'discretionary' ? 'Marqué comme discrétionnaire. Cliquer pour retirer.'
      : "Marquer cette série comme essentielle.";

  // Three-tier row on mobile: (1) label + amount, (2) cadence/next/count
  // meta, (3) actions wrap. Prevents the label from getting squeezed by
  // the Confirmer/Ignorer/Marquer trio at 375px viewports.
  return (
    <li className="flex flex-col gap-1.5 py-3 px-1 border-b border-ink-900/50 last:border-b-0">
      <div className="flex items-baseline gap-3 min-w-0">
        <div className="flex items-baseline gap-2 min-w-0 flex-1">
          <span className="text-sm text-ink-100 truncate min-w-0">{row.label}</span>
          {isConfirmed && (
            <span className="text-[10px] uppercase tracking-wider text-sage-300/80 border border-sage-800/60 rounded-full px-1.5 py-[1px] shrink-0">
              Confirmé
            </span>
          )}
        </div>
        <div className={`text-sm font-mono tabular-nums shrink-0 ${amountSignClass(row.avgAmount)}`}>
          {formatAmount(row.avgAmount)}
        </div>
      </div>
      <div className="text-xs text-ink-500 flex flex-wrap gap-x-3 gap-y-0.5">
        <span>{cadenceLabel(row.cadenceDays)}</span>
        <span>Prochain le {formatDate(row.nextDueAt)}</span>
        <span>{row.memberCount} occurrences</span>
      </div>
      {row.priceCreep && <PriceCreepChip creep={row.priceCreep} />}
      <div className="flex flex-wrap items-center gap-1 pt-0.5">
        {!isConfirmed && (
          <button
            type="button"
            className="btn-secondary !min-h-0 !py-1 !px-2 text-xs"
            onClick={() => onUpdate({ status: 'confirmed' })}
          >Confirmer</button>
        )}
        <button
          type="button"
          className="btn-ghost !min-h-0 !py-1 !px-2 text-xs"
          onClick={() => onUpdate({ status: 'dismissed' })}
        >Ignorer</button>
        <button
          type="button"
          className={`btn-ghost !min-h-0 !py-1 !px-2 text-xs ${essentialness ? 'text-sage-300' : 'text-ink-500'}`}
          title={essentialnessTitle}
          onClick={cycleEssentialness}
        >{essentialnessLabel}</button>
      </div>
    </li>
  );
}
