import type { ReactNode } from 'react';
import { formatAmount, amountSignClass } from '../lib/format';

// Generic stat card for the Dashboard. Keeps a consistent look so new stats
// can be added without inventing per-widget styling: label at the top,
// prominent value in the middle, optional hint underneath. All amounts are
// wrapped with `.private` so the privacy toggle in the sidebar blurs them
// like every other on-screen amount.
//
// Tone drives the value's color:
//   - 'auto' picks sage/clay/ink from the sign of `value` (matches how
//     transactions render amounts elsewhere in the app).
//   - 'sage' / 'clay' / 'amber' / 'ink' pin an explicit color regardless of
//     sign (useful when a positive expense-average should still read as
//     "spent = bad" via clay, etc.).

type Tone = 'auto' | 'sage' | 'clay' | 'amber' | 'ink';

interface Props {
  label: string;
  value: number;
  currency?: string;
  hint?: string;
  tone?: Tone;
  /** When true, wrap the amount in .private so it blurs with the privacy toggle. */
  privateAmount?: boolean;
  /** Small icon or emoji rendered to the left of the label. */
  icon?: ReactNode;
  /** Optional secondary metric — rendered small under the main value.
      Common use: previous-period comparison or trend arrow. */
  footer?: ReactNode;
}

const TONE_CLASS: Record<Exclude<Tone, 'auto'>, string> = {
  sage: 'text-sage-300',
  clay: 'text-clay-300',
  amber: 'text-amber-300',
  ink: 'text-ink-100',
};

export function StatWidget({
  label,
  value,
  currency = 'EUR',
  hint,
  tone = 'auto',
  privateAmount = true,
  icon,
  footer,
}: Props): JSX.Element {
  const valueClass = tone === 'auto' ? amountSignClass(value) : TONE_CLASS[tone];
  return (
    <div className="surface p-5 flex flex-col gap-1.5">
      <div className="label flex items-center gap-2">
        {icon && <span className="text-ink-400 text-base leading-none">{icon}</span>}
        <span>{label}</span>
      </div>
      <div className={`display text-3xl tabular-nums ${valueClass}`}>
        <span className={privateAmount ? 'private' : undefined}>
          {formatAmount(value, currency)}
        </span>
      </div>
      {hint && <div className="text-[11px] text-ink-500 mt-0.5">{hint}</div>}
      {footer && <div className="text-[11px] text-ink-400 mt-1">{footer}</div>}
    </div>
  );
}
