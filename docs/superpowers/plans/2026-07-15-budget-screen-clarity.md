# Budget Screen Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Presentation-only rewrite of `SummaryCard` and `BudgetRow` so a two-second glance at the Budget screen answers "am I OK this month, by how much?"

**Architecture:** Two React components get their render trees rewritten around one primary sentence + one muted secondary line each. No new state, no new props, no new API fields. The pace/over/on-track branch on both components is derived from existing `totals` / row fields. The now-unused local `pages/Budgets/Sparkline.tsx` and `normalizeSparkline` helper are removed.

**Tech Stack:** React 18, TypeScript, Vitest + `@testing-library/react`, Tailwind CSS. Package manager is `pnpm` — run all frontend commands as `pnpm --filter frontend <cmd>`.

## Global Constraints

- **French copy verbatim** — labels below appear in the UI exactly as spelled: `Vous avez dépensé`, `sur`, `ce mois-ci`, `cette année`, `Il reste`, `d'ici la fin du mois`, `d'ici la fin de l'année`, `À ce rythme, vous dépasserez de`, `Vous avez dépassé de`, `Reste`, `Dépassé de`, `À ce rythme`, `Habituellement`, `restants · à surveiller`, `dépensés`, `inhabituel`.
- **Public-safe commits** — no IPs, hostnames, or secrets in code or messages (project is going public).
- **Commit directly on `main`** — no feature branches. Do not push unless the user asks.
- **Attribute commits to Gekkotron** — every `git commit` must be prefixed with `git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com`.
- **French decimal inputs** — never use `<input type="number">`; existing `BudgetRow` edit input already uses `inputMode="decimal"` + `parseDecimal` — keep it that way.
- **No dot glyph** for anomaly signal — plain text ` · inhabituel` only (the ` · ` middle-dot is used as a separator, not as a status glyph).
- **Progress bar has no `% overlay`** — the bar itself carries the signal.
- **Neutral card tint** — `SummaryCard` no longer changes its own background based on pace; color lives on the status line only.
- **Preserve `barColor`, `normalizeLimit`, `paceState`** in `BudgetRow.tsx` — they still power the progress bar and edit input.
- **No changes** to `SuggestionCard`, `UnbudgetedSection`, `AddBudgetForm`, `PeriodSelector`, `AccountFilter`, `Budgets/index.tsx`, backend routes, API types, or SQL.

---

### Task 1: Rewrite `SummaryCard`

**Files:**
- Modify: `frontend/src/pages/Budgets/SummaryCard.tsx` (full render rewrite)
- Modify: `frontend/src/pages/Budgets/__tests__/SummaryCard.test.tsx` (replace assertions for new hero + status line + no mini-chart)

**Interfaces:**
- Consumes: `totals: { limit: string; spent: string; remaining: string; projected: string | null }` and `period: 'monthly' | 'yearly'` from `BudgetReport` (unchanged shape; `rows` and `monthOrYear` props are still accepted for signature compatibility but unused inside).
- Produces: nothing new — `SummaryCard` is only consumed by `Budgets/index.tsx` (unchanged).

- [ ] **Step 1: Rewrite `SummaryCard.test.tsx` with the new assertions**

Replace the whole file with:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SummaryCard } from '../SummaryCard';

describe('SummaryCard', () => {
  it('renders the hero sentence with spent and limit for monthly period', () => {
    render(<SummaryCard
      totals={{ limit: '3000.00', spent: '2340.00', remaining: '660.00', projected: '3180.00' }}
      rows={[]}
      period="monthly"
      monthOrYear="2026-07"
    />);
    expect(screen.getByText(/Vous avez dépensé/)).toBeInTheDocument();
    expect(screen.getByText(/2\s?340,00/)).toBeInTheDocument();
    expect(screen.getByText(/3\s?000,00/)).toBeInTheDocument();
    expect(screen.getByText(/ce mois-ci/)).toBeInTheDocument();
  });

  it('renders the hero sentence with "cette année" for yearly period', () => {
    render(<SummaryCard
      totals={{ limit: '30000.00', spent: '12000.00', remaining: '18000.00', projected: null }}
      rows={[]}
      period="yearly"
      monthOrYear="2026"
    />);
    expect(screen.getByText(/cette année/)).toBeInTheDocument();
  });

  it('shows the on-track status line when projected is null and remaining is positive', () => {
    render(<SummaryCard
      totals={{ limit: '3000.00', spent: '2340.00', remaining: '660.00', projected: null }}
      rows={[]}
      period="monthly"
      monthOrYear="2026-07"
    />);
    expect(screen.getByText(/Il reste/)).toBeInTheDocument();
    expect(screen.getByText(/d'ici la fin du mois/)).toBeInTheDocument();
    expect(screen.getByText(/660,00/)).toBeInTheDocument();
  });

  it('shows the slipping status line when projected exceeds limit but not yet over', () => {
    render(<SummaryCard
      totals={{ limit: '3000.00', spent: '2340.00', remaining: '660.00', projected: '3180.00' }}
      rows={[]}
      period="monthly"
      monthOrYear="2026-07"
    />);
    expect(screen.getByText(/À ce rythme, vous dépasserez de/)).toBeInTheDocument();
    expect(screen.getByText(/180,00/)).toBeInTheDocument();
  });

  it('shows the over status line when remaining is negative', () => {
    render(<SummaryCard
      totals={{ limit: '3000.00', spent: '3200.00', remaining: '-200.00', projected: '3500.00' }}
      rows={[]}
      period="monthly"
      monthOrYear="2026-07"
    />);
    expect(screen.getByText(/Vous avez dépassé de/)).toBeInTheDocument();
    expect(screen.getByText(/200,00/)).toBeInTheDocument();
  });

  it('does not render the old "Dépassement projeté" pill nor a mini bar chart', () => {
    render(<SummaryCard
      totals={{ limit: '100.00', spent: '80.00', remaining: '20.00', projected: '150.00' }}
      rows={[]}
      period="monthly"
      monthOrYear="2026-07"
    />);
    expect(screen.queryByText(/Dépassement projeté/i)).toBeNull();
    expect(document.querySelectorAll('[data-testid="summary-mini-bar"]').length).toBe(0);
  });

  it('uses the yearly on-track copy for yearly period', () => {
    render(<SummaryCard
      totals={{ limit: '30000.00', spent: '12000.00', remaining: '18000.00', projected: null }}
      rows={[]}
      period="yearly"
      monthOrYear="2026"
    />);
    expect(screen.getByText(/d'ici la fin de l'année/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests — expect them to fail**

Run: `pnpm --filter frontend test -- src/pages/Budgets/__tests__/SummaryCard.test.tsx`
Expected: FAIL — the current `SummaryCard` still renders the old copy (`Projection`, `Dépassement projeté`, the `<svg>` mini-chart), so the new-copy assertions won't match.

- [ ] **Step 3: Rewrite `SummaryCard.tsx`**

Replace the entire file with:

```tsx
import type { BudgetReport } from '../../api/types';
import { formatAmount } from '../../lib/format';

type StatusVariant = 'over' | 'slipping' | 'onTrack';

function statusVariant(totals: BudgetReport['totals']): StatusVariant {
  if (Number(totals.remaining) < 0) return 'over';
  if (totals.projected != null && Number(totals.projected) > Number(totals.limit)) return 'slipping';
  return 'onTrack';
}

function statusLine(
  variant: StatusVariant,
  totals: BudgetReport['totals'],
  period: BudgetReport['period'],
): { text: JSX.Element; className: string } {
  const endOfPeriod = period === 'monthly' ? "d'ici la fin du mois" : "d'ici la fin de l'année";
  if (variant === 'over') {
    const amount = formatAmount((-Number(totals.remaining)).toFixed(2));
    return {
      text: <>Vous avez dépassé de <span className="private tabular-nums">{amount}</span>.</>,
      className: 'text-clay-300',
    };
  }
  if (variant === 'slipping' && totals.projected != null) {
    const over = (Number(totals.projected) - Number(totals.limit)).toFixed(2);
    return {
      text: <>À ce rythme, vous dépasserez de <span className="private tabular-nums">{formatAmount(over)}</span>.</>,
      className: 'text-amber-300',
    };
  }
  return {
    text: <>Il reste <span className="private tabular-nums">{formatAmount(totals.remaining)}</span> {endOfPeriod}.</>,
    className: 'text-sage-300',
  };
}

export function SummaryCard(props: {
  totals: BudgetReport['totals'];
  rows: BudgetReport['rows'];
  period: BudgetReport['period'];
  monthOrYear: string;
}): JSX.Element {
  const { totals, period } = props;
  const when = period === 'monthly' ? 'ce mois-ci' : 'cette année';
  const status = statusLine(statusVariant(totals), totals, period);

  return (
    <div className="surface p-4 border border-ink-800/60 flex flex-col gap-2">
      <p className="text-lg text-ink-200">
        Vous avez dépensé{' '}
        <span className="text-ink-50 font-semibold tabular-nums private">
          {formatAmount(totals.spent)}
        </span>{' '}
        sur{' '}
        <span className="tabular-nums private">{formatAmount(totals.limit)}</span>{' '}
        {when}.
      </p>
      <p className={`text-sm ${status.className}`}>{status.text}</p>
    </div>
  );
}
```

- [ ] **Step 4: Run the SummaryCard tests — expect PASS**

Run: `pnpm --filter frontend test -- src/pages/Budgets/__tests__/SummaryCard.test.tsx`
Expected: PASS on all 7 tests.

- [ ] **Step 5: Run the whole Budgets folder to catch collateral breakage**

Run: `pnpm --filter frontend test -- src/pages/Budgets`
Expected: PASS on every file except (possibly) page-level `Budgets.test.tsx` (covered in Task 4) and `BudgetRow.test.tsx` (covered in Task 2). If a Budgets-folder test other than those two fails, stop and diagnose before continuing.

- [ ] **Step 6: Commit**

```bash
git -C /Users/julienhuguel/superconductor/projects/Athena-Accounting add \
  frontend/src/pages/Budgets/SummaryCard.tsx \
  frontend/src/pages/Budgets/__tests__/SummaryCard.test.tsx
git -C /Users/julienhuguel/superconductor/projects/Athena-Accounting \
  -c user.name=Gekkotron \
  -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "$(cat <<'EOF'
refactor(frontend): SummaryCard becomes a one-sentence hero + status line

Drops the mini bar chart, the "Projection / Dépassement projeté" pill,
and the pace-tinted card background. One primary sentence
("Vous avez dépensé X sur Y ce mois-ci.") plus one contextual status
line covering on-track, slipping, and over.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Rewrite `BudgetRow`

**Files:**
- Modify: `frontend/src/pages/Budgets/BudgetRow.tsx` (full render rewrite; keep `barColor`, `normalizeLimit`, `paceState`)
- Modify: `frontend/src/pages/Budgets/__tests__/BudgetRow.test.tsx` (replace assertions for new copy + no % overlay + no sparkline + anomaly-as-text)

**Interfaces:**
- Consumes: `BudgetReportRow` (unchanged) + `depth: 0 | 1`, `budgetId?: number`, `onSave(id, limit)`, `onDelete(id)` — same props as today; no signature change.
- Produces: no exports beyond `BudgetRow` itself; caller (`Budgets/index.tsx`) is unchanged.

- [ ] **Step 1: Rewrite `BudgetRow.test.tsx` with the new assertions**

Replace the whole file with:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BudgetRow } from '../BudgetRow';

const row = {
  id: 1, categoryId: 42, name: 'Restaurants', color: null, parentId: null, accountId: null,
  period: 'monthly' as const, limit: '50.00', currency: 'EUR',
  spent: '38.20', remaining: '11.80', pct: 76, over: false,
  projected: '91.10',
  history: { values: ['42.15','51.30','48.90','55.10','39.80','62.25'], average: '49.92', median: '50.10' },
  anomaly: true,
  suggestedLimit: null,
};

describe('BudgetRow', () => {
  it('renders the category name and the primary status "Reste X sur Y" when on track', () => {
    render(<BudgetRow
      row={{ ...row, projected: '45.00', anomaly: false }}
      depth={0} budgetId={10} onSave={() => {}} onDelete={() => {}}
    />);
    expect(screen.getByText('Restaurants')).toBeInTheDocument();
    expect(screen.getByText(/Reste/)).toBeInTheDocument();
    expect(screen.getByText(/11,80/)).toBeInTheDocument();
    expect(screen.getByText(/50,00/)).toBeInTheDocument();
  });

  it('renders the amber "à surveiller" status when projected exceeds limit but not yet over', () => {
    render(<BudgetRow row={row} depth={0} budgetId={10} onSave={() => {}} onDelete={() => {}} />);
    expect(screen.getByText(/à surveiller/)).toBeInTheDocument();
    expect(screen.getByText(/11,80/)).toBeInTheDocument();
  });

  it('renders "Dépassé de X" when the row is over', () => {
    render(<BudgetRow
      row={{ ...row, spent: '75.00', limit: '50.00', remaining: '-25.00', over: true, pct: 150 }}
      depth={0} budgetId={10} onSave={() => {}} onDelete={() => {}}
    />);
    expect(screen.getByText(/Dépassé de/)).toBeInTheDocument();
    expect(screen.getByText(/25,00/)).toBeInTheDocument();
  });

  it('renders the muted trend clause with both "À ce rythme" and "Habituellement"', () => {
    render(<BudgetRow row={row} depth={0} budgetId={10} onSave={() => {}} onDelete={() => {}} />);
    expect(screen.getByText(/À ce rythme/)).toBeInTheDocument();
    expect(screen.getByText(/91,10/)).toBeInTheDocument();
    expect(screen.getByText(/Habituellement/)).toBeInTheDocument();
    expect(screen.getByText(/49,92/)).toBeInTheDocument();
  });

  it('renders the trend clause with only "Habituellement" when projected is null', () => {
    render(<BudgetRow
      row={{ ...row, projected: null }}
      depth={0} budgetId={10} onSave={() => {}} onDelete={() => {}}
    />);
    expect(screen.queryByText(/À ce rythme/)).toBeNull();
    expect(screen.getByText(/Habituellement/)).toBeInTheDocument();
  });

  it('hides the trend clause entirely when neither projected nor history is present', () => {
    render(<BudgetRow
      row={{ ...row, projected: null, history: null, anomaly: false }}
      depth={0} budgetId={10} onSave={() => {}} onDelete={() => {}}
    />);
    expect(screen.queryByText(/À ce rythme/)).toBeNull();
    expect(screen.queryByText(/Habituellement/)).toBeNull();
    expect(screen.queryByText(/inhabituel/)).toBeNull();
  });

  it('appends " · inhabituel" inline in the trend clause when row.anomaly is true', () => {
    render(<BudgetRow row={row} depth={0} budgetId={10} onSave={() => {}} onDelete={() => {}} />);
    expect(screen.getByText(/inhabituel/)).toBeInTheDocument();
  });

  it('does not render the old anomaly pill glyph nor the % overlay', () => {
    render(<BudgetRow row={row} depth={0} budgetId={10} onSave={() => {}} onDelete={() => {}} />);
    // Old pill was "● anomalie"; new signal is plain " · inhabituel" text.
    expect(screen.queryByText(/anomalie/i)).toBeNull();
    // The 76% overlay text is gone.
    expect(screen.queryByText('76%')).toBeNull();
  });

  it('does not render a per-row sparkline SVG anymore', () => {
    const { container } = render(<BudgetRow row={row} depth={0} budgetId={10} onSave={() => {}} onDelete={() => {}} />);
    // The progress bar is a <div>, not an <svg> — after the rewrite the row
    // contains zero <svg> elements.
    expect(container.querySelectorAll('svg').length).toBe(0);
  });

  it('enters edit mode and saves on OK (unchanged behavior)', () => {
    const onSave = vi.fn();
    render(<BudgetRow row={row} depth={0} budgetId={10} onSave={onSave} onDelete={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Modifier/i }));
    const input = screen.getByLabelText(/Modifier le plafond/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '75.00' } });
    fireEvent.click(screen.getByRole('button', { name: /^OK$/i }));
    expect(onSave).toHaveBeenCalledWith(10, '75.00');
  });

  it('accepts the French decimal comma and saves it canonicalized (unchanged behavior)', () => {
    const onSave = vi.fn();
    render(<BudgetRow row={row} depth={0} budgetId={10} onSave={onSave} onDelete={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Modifier/i }));
    const input = screen.getByLabelText(/Modifier le plafond/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '75,25' } });
    fireEvent.click(screen.getByRole('button', { name: /^OK$/i }));
    expect(onSave).toHaveBeenCalledWith(10, '75.25');
  });
});
```

- [ ] **Step 2: Run the tests — expect them to fail**

Run: `pnpm --filter frontend test -- src/pages/Budgets/__tests__/BudgetRow.test.tsx`
Expected: FAIL — the current row still renders `spent / limit`, `~projected`, `avg`, the % overlay, the sparkline SVG, and the `● anomalie` pill.

- [ ] **Step 3: Rewrite `BudgetRow.tsx`**

Replace the entire file with:

```tsx
import { useState } from 'react';
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

function primaryStatus(r: BudgetReportRow): PrimaryStatus {
  if (Number(r.limit) === 0) {
    return {
      text: <><span className="private tabular-nums">{formatAmount(r.spent, r.currency)}</span> dépensés</>,
      className: 'text-ink-300',
    };
  }
  if (r.over) {
    const overBy = formatAmount((-Number(r.remaining)).toFixed(2), r.currency);
    return {
      text: <>Dépassé de <span className="private tabular-nums">{overBy}</span></>,
      className: 'text-clay-300',
    };
  }
  if (paceState(r) === 'over') {
    return {
      text: <>
        <span className="private tabular-nums">{formatAmount(r.remaining, r.currency)}</span>
        {' '}restants · à surveiller
      </>,
      className: 'text-amber-300',
    };
  }
  return {
    text: <>
      Reste{' '}
      <span className="private tabular-nums">{formatAmount(r.remaining, r.currency)}</span>
      {' '}sur{' '}
      <span className="private tabular-nums">{formatAmount(r.limit, r.currency)}</span>
    </>,
    className: 'text-sage-300',
  };
}

function trendClause(r: BudgetReportRow): JSX.Element | null {
  const hasProjected = r.projected != null;
  const hasAverage = r.history != null;
  if (!hasProjected && !hasAverage && !r.anomaly) return null;
  const parts: JSX.Element[] = [];
  if (hasProjected) {
    parts.push(
      <span key="pace">
        À ce rythme{' '}
        <span className="private tabular-nums">{formatAmount(r.projected!, r.currency)}</span>
      </span>,
    );
  }
  if (hasAverage) {
    parts.push(
      <span key="avg">
        Habituellement{' '}
        <span className="private tabular-nums">{formatAmount(r.history!.average, r.currency)}</span>
      </span>,
    );
  }
  if (r.anomaly) parts.push(<span key="anom">inhabituel</span>);
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
  const { row: r, depth, budgetId, onSave, onDelete } = props;
  const pct = Math.min(Math.max(r.pct, 0), 100);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(r.limit);
  const status = primaryStatus(r);
  const trend = trendClause(r);

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
        <span>{trend ?? ' '}</span>
        {budgetId !== undefined && (editing ? (
          <span className="flex items-center gap-1">
            <input
              className="input w-24 !py-1"
              inputMode="decimal"
              aria-label="Modifier le plafond"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            {r.suggestedLimit && (
              <span className="text-[10px] text-ink-500">
                Suggéré : {formatAmount(r.suggestedLimit, r.currency)}
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
            >Annuler</button>
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => setEditing(true)}>Modifier</button>
            <button className="btn-ghost !py-1 !px-2 text-xs text-clay-300" onClick={() => onDelete(budgetId)}>Supprimer</button>
          </span>
        ))}
      </div>
    </li>
  );
}
```

- [ ] **Step 4: Run the BudgetRow tests — expect PASS**

Run: `pnpm --filter frontend test -- src/pages/Budgets/__tests__/BudgetRow.test.tsx`
Expected: PASS on all 11 tests.

- [ ] **Step 5: Commit**

```bash
git -C /Users/julienhuguel/superconductor/projects/Athena-Accounting add \
  frontend/src/pages/Budgets/BudgetRow.tsx \
  frontend/src/pages/Budgets/__tests__/BudgetRow.test.tsx
git -C /Users/julienhuguel/superconductor/projects/Athena-Accounting \
  -c user.name=Gekkotron \
  -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "$(cat <<'EOF'
refactor(frontend): BudgetRow becomes one primary status + one muted trend line

Drops the % overlay, the sparkline SVG, and the "● anomalie" pill. The
row now shows: name + colored status ("Reste X sur Y" / "X restants · à
surveiller" / "Dépassé de X"), progress bar, and one muted line
("À ce rythme X · Habituellement Y[ · inhabituel]") with the edit and
delete buttons.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Delete the now-unused `pages/Budgets/Sparkline.tsx` and `normalizeSparkline`

**Files:**
- Delete: `frontend/src/pages/Budgets/Sparkline.tsx`
- Modify: `frontend/src/pages/Budgets/budget-math.ts` (remove `normalizeSparkline` export)
- Modify: `frontend/src/pages/Budgets/__tests__/budget-math.test.ts` (remove the `describe('normalizeSparkline', …)` block)

**Interfaces:**
- Consumes: nothing new.
- Produces: after this task, `normalizeSparkline` no longer exists. The unrelated shared component `frontend/src/components/Sparkline.tsx` (used by `Dashboard/InsightsSection.tsx`) is **not** touched.

- [ ] **Step 1: Confirm zero remaining imports of the local sparkline**

Run:
```bash
grep -rn "from './Sparkline'" /Users/julienhuguel/superconductor/projects/Athena-Accounting/frontend/src/pages/Budgets
grep -rn "normalizeSparkline" /Users/julienhuguel/superconductor/projects/Athena-Accounting/frontend/src
```

Expected first grep: no output (Tasks 1 & 2 removed the only two callers).
Expected second grep: only lines inside `pages/Budgets/budget-math.ts` and `pages/Budgets/__tests__/budget-math.test.ts` — no consumers.

If any consumer still exists, STOP and revisit; do not delete.

- [ ] **Step 2: Delete the file**

Run: `git -C /Users/julienhuguel/superconductor/projects/Athena-Accounting rm frontend/src/pages/Budgets/Sparkline.tsx`

- [ ] **Step 3: Remove `normalizeSparkline` from `budget-math.ts`**

Open `frontend/src/pages/Budgets/budget-math.ts` and delete the entire `export function normalizeSparkline(...)` block (about lines 3–15 in the current file). Leave the other exports (`summarizePace`, `topLevelRows`) untouched.

- [ ] **Step 4: Remove the matching test block from `budget-math.test.ts`**

Open `frontend/src/pages/Budgets/__tests__/budget-math.test.ts` and delete:
- The `normalizeSparkline` import (change `import { normalizeSparkline, summarizePace, topLevelRows } from '../budget-math';` to `import { summarizePace, topLevelRows } from '../budget-math';`).
- The entire `describe('normalizeSparkline', () => { … })` block.

- [ ] **Step 5: Run the whole frontend test suite**

Run: `pnpm --filter frontend test`
Expected: PASS on every file. If a file previously importing `normalizeSparkline` breaks, either it was missed by the grep in Step 1 (revisit) or another consumer exists that must be updated in the same commit.

- [ ] **Step 6: Commit**

```bash
git -C /Users/julienhuguel/superconductor/projects/Athena-Accounting add \
  frontend/src/pages/Budgets/budget-math.ts \
  frontend/src/pages/Budgets/__tests__/budget-math.test.ts
git -C /Users/julienhuguel/superconductor/projects/Athena-Accounting \
  -c user.name=Gekkotron \
  -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "$(cat <<'EOF'
refactor(frontend): drop unused Budgets sparkline and normalizeSparkline helper

Now that SummaryCard and BudgetRow no longer render sparklines, the
Budgets-local Sparkline component and its normalizeSparkline helper are
dead code. The shared Sparkline in components/ (used by Dashboard) is
untouched.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Update page-level `Budgets.test.tsx` and manually smoke-test the screen

**Files:**
- Modify: `frontend/src/pages/__tests__/Budgets.test.tsx` (update the copy assertions that referenced the old text)

**Interfaces:**
- Consumes: no code from earlier tasks (this only realigns the page-level suite with the new copy).
- Produces: nothing.

- [ ] **Step 1: Update the "renders a budgeted category row" test to use the new copy**

The current test asserts `getByText(/reste/i)` — that still passes, since the new `SummaryCard` says "Il reste" and `BudgetRow` says "Reste X sur Y". But it also asserts `getAllByText(/240/)` for the spent amount which currently appears in *both* the summary and the row. After the rewrite it still appears in both — the summary shows it in the hero sentence and the row shows it in the progress bar aria state (not text) or elsewhere. Verify by running the test first, then patch.

Open `frontend/src/pages/__tests__/Budgets.test.tsx` and locate the block starting `it('renders a budgeted category row with spent / limit', async () => {`. Ensure the three assertions are:

```tsx
expect((await screen.findAllByText('Restaurants')).length).toBeGreaterThan(0);
// "240" still appears in the SummaryCard hero ("Vous avez dépensé 240,00 …").
expect((await screen.findAllByText(/240/)).length).toBeGreaterThan(0);
// "Reste" now appears in the SummaryCard's status line AND in the row primary line.
expect((await screen.findAllByText(/reste/i)).length).toBeGreaterThan(0);
```

If any assertion needs a wording change (e.g., because "240" no longer appears in the row), patch it to a working query — but do NOT relax it to something meaningless like "the page rendered". The intent is: category name, spent amount, and "reste" copy are all visible.

- [ ] **Step 2: Update the "red bar when over budget" test**

Locate `it('shows a red (not amber) bar when over budget even though pct rounds to 100', …)`. Ensure the assertion still uses `getByText(/dépassé/i)` — the row now says `Dépassé de X` and the `SummaryCard` may say `Vous avez dépassé de X`, so both match the case-insensitive regex. The two class-selector assertions (`.bg-clay-500` present, `.bg-amber-500` absent) still hold because `barColor` is unchanged.

- [ ] **Step 3: Run the page-level test file**

Run: `pnpm --filter frontend test -- src/pages/__tests__/Budgets.test.tsx`
Expected: PASS on all 4 tests. If a test fails, patch the specific assertion — do not disable the test.

- [ ] **Step 4: Run the whole frontend suite one more time**

Run: `pnpm --filter frontend test`
Expected: PASS everywhere.

- [ ] **Step 5: Manual smoke check in the browser**

Start the dev server:
```bash
pnpm --filter frontend dev
```

Open `http://localhost:5173/budgets` and verify each of these:
1. **On-track scenario** — a category well under its limit shows: name (left), `Reste X sur Y` in sage (right), muted trend line, progress bar under 80%.
2. **Slipping scenario** — a category where projected exceeds limit but current spent is still under it shows: `X restants · à surveiller` in amber, progress bar between 80 % and 100 %.
3. **Over scenario** — a category over limit shows: `Dépassé de X` in clay/red, red progress bar.
4. **Anomaly** — a row with `anomaly: true` shows ` · inhabituel` appended to the muted trend line (no dot glyph, no pill).
5. **SummaryCard** — top of screen shows the one-sentence hero + one colored status line; no mini bar chart is visible; card background is neutral (not tinted).
6. **Yearly period** — switch to yearly; hero reads `cette année`; on-track status reads `d'ici la fin de l'année`.
7. **Editing** — click `Modifier` on a row; the input, `OK`, `Annuler` still work; French-comma value (`75,25`) still saves canonicalized.

If any point fails, note which and stop; do not commit until it works.

- [ ] **Step 6: Commit (only if step 1 or 2 changed anything)**

If `Budgets.test.tsx` was not modified, skip this commit. Otherwise:

```bash
git -C /Users/julienhuguel/superconductor/projects/Athena-Accounting add \
  frontend/src/pages/__tests__/Budgets.test.tsx
git -C /Users/julienhuguel/superconductor/projects/Athena-Accounting \
  -c user.name=Gekkotron \
  -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "$(cat <<'EOF'
test(frontend): realign page-level Budgets tests with new SummaryCard / BudgetRow copy

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
