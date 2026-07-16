import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { BudgetReportRow } from '../../api/types';
import { formatAmount, parseDecimal } from '../../lib/format';

function barColor(pct: number, over: boolean): string {
  if (over) return 'bg-clay-500';
  if (pct >= 80) return 'bg-amber-500';
  return 'bg-sage-500';
}

function normalizeLimit(v: string): string | null {
  const cleaned = parseDecimal(v);
  if (cleaned === null) return null;
  return Number(cleaned) > 0 ? cleaned : null;
}

function paceState(row: BudgetReportRow): 'over' | 'onTrack' | 'unknown' {
  if (row.projected == null) return 'unknown';
  return Number(row.projected) > Number(row.limit) ? 'over' : 'onTrack';
}

type PrimaryStatus = { text: JSX.Element; className: string };

function primaryStatus(r: BudgetReportRow, t: TFunction): PrimaryStatus {
  if (Number(r.limit) === 0) {
    return {
      text: (
        <Trans t={t} i18nKey="row.spentOnly">
          <span className="private tabular-nums">{{ amount: formatAmount(r.spent, r.currency) } as unknown as string}</span> spent
        </Trans>
      ),
      className: 'text-ink-300',
    };
  }
  if (r.over) {
    const overBy = formatAmount((-Number(r.remaining)).toFixed(2), r.currency);
    return {
      text: (
        <Trans t={t} i18nKey="row.overBy">
          Exceeded by <span className="private tabular-nums">{{ amount: overBy } as unknown as string}</span>
        </Trans>
      ),
      className: 'text-clay-300',
    };
  }
  if (paceState(r) === 'over') {
    return {
      text: (
        <Trans t={t} i18nKey="row.remainingWatch">
          <span className="private tabular-nums">{{ amount: formatAmount(r.remaining, r.currency) } as unknown as string}</span> left · watch out
        </Trans>
      ),
      className: 'text-amber-300',
    };
  }
  return {
    text: (
      <Trans t={t} i18nKey="row.remainingOf">
        Left <span className="private tabular-nums">{{ remaining: formatAmount(r.remaining, r.currency) } as unknown as string}</span> of <span className="private tabular-nums">{{ limit: formatAmount(r.limit, r.currency) } as unknown as string}</span>
      </Trans>
    ),
    className: 'text-sage-300',
  };
}

function trendClause(r: BudgetReportRow, t: TFunction): JSX.Element | null {
  const hasProjected = r.projected != null;
  const hasAverage = r.history != null;
  if (!hasProjected && !hasAverage && !r.anomaly) return null;
  const parts: JSX.Element[] = [];
  if (hasProjected) {
    parts.push(
      <span key="pace">
        <Trans t={t} i18nKey="row.pace">
          At this pace <span className="private tabular-nums">{{ amount: formatAmount(r.projected!, r.currency) } as unknown as string}</span>
        </Trans>
      </span>,
    );
  }
  if (hasAverage) {
    parts.push(
      <span key="avg">
        <Trans t={t} i18nKey="row.usual">
          Usually <span className="private tabular-nums">{{ amount: formatAmount(r.history!.average, r.currency) } as unknown as string}</span>
        </Trans>
      </span>,
    );
  }
  if (r.anomaly) parts.push(<span key="anom">{t('row.anomaly')}</span>);
  return (
    <span>
      {parts.map((p, i) => (
        <span key={i}>{i > 0 ? ' · ' : ''}{p}</span>
      ))}
    </span>
  );
}

export function BudgetRow(props: {
  row: BudgetReportRow;
  depth: 0 | 1;
  budgetId: number | undefined;
  onSave: (id: number, limit: string) => void;
  onDelete: (id: number) => void;
}): JSX.Element {
  const { t } = useTranslation(['budgets', 'common']);
  const { row: r, depth, budgetId, onSave, onDelete } = props;
  const pct = Math.min(Math.max(r.pct, 0), 100);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(r.limit);
  const status = primaryStatus(r, t);
  const trend = trendClause(r, t);

  return (
    <li
      data-role="budget-row"
      data-depth={depth}
      className={`surface p-4 ${depth === 1 ? 'ml-8 bg-ink-900/20' : ''}`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium">{r.name}</span>
        <span className={`text-sm ${status.className}`}>{status.text}</span>
      </div>

      <div
        className="h-2 rounded-full bg-ink-800 overflow-hidden"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={`h-full ${barColor(r.pct, r.over)}`} style={{ width: `${pct}%` }} />
      </div>

      <div className="flex items-center justify-between mt-2 text-xs text-ink-500">
        <span>{trend ?? ' '}</span>
        {budgetId !== undefined && (editing ? (
          <span className="flex items-center gap-1">
            <input
              className="input w-24 !py-1"
              inputMode="decimal"
              aria-label={t('row.editAriaLabel')}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            {r.suggestedLimit && (
              <span className="text-[10px] text-ink-500">
                {t('row.suggested', { amount: formatAmount(r.suggestedLimit, r.currency) })}
              </span>
            )}
            <button
              className="btn-ghost !py-1 !px-2 text-xs"
              onClick={() => {
                const cleaned = normalizeLimit(value);
                if (cleaned !== null) { onSave(budgetId, cleaned); setEditing(false); }
              }}
            >OK</button>
            <button
              className="btn-ghost !py-1 !px-2 text-xs"
              onClick={() => { setValue(r.limit); setEditing(false); }}
            >{t('cancel', { ns: 'common' })}</button>
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => setEditing(true)}>{t('edit', { ns: 'common' })}</button>
            <button className="btn-ghost !py-1 !px-2 text-xs text-clay-300" onClick={() => onDelete(budgetId)}>{t('delete', { ns: 'common' })}</button>
          </span>
        ))}
      </div>
    </li>
  );
}
