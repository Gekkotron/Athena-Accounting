import type { BudgetPeriod } from '../../api/types';

function shiftMonth(m: string, delta: number): string {
  const [y, mm] = m.split('-').map(Number);
  const d = new Date(y!, mm! - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function shiftYear(y: string, delta: number): string {
  return String(Number(y) + delta);
}

export function PeriodSelector(props: {
  period: BudgetPeriod;
  monthOrYear: string;
  onChange: (v: { period: BudgetPeriod; monthOrYear: string }) => void;
}): JSX.Element {
  const { period, monthOrYear, onChange } = props;
  const shift = (delta: number) => onChange({
    period,
    monthOrYear: period === 'monthly' ? shiftMonth(monthOrYear, delta) : shiftYear(monthOrYear, delta),
  });
  const toggle = (next: BudgetPeriod) => {
    if (next === period) return;
    // When switching, default the value to the same anchor (this year / this month).
    if (next === 'monthly') {
      const y = period === 'yearly' ? monthOrYear : monthOrYear.slice(0, 4);
      onChange({ period: 'monthly', monthOrYear: `${y}-01` });
    } else {
      onChange({ period: 'yearly', monthOrYear: monthOrYear.slice(0, 4) });
    }
  };
  return (
    <div className="flex items-center gap-2">
      <div className="flex rounded-md bg-ink-800/40 p-0.5">
        {/* aria-label avoids overlapping the "Mois précédent" accessible name
            below — otherwise a plain /Mois/i role query matches both. */}
        <button
          type="button"
          aria-label="Vue mensuelle"
          className={`px-3 py-1 text-xs rounded ${period === 'monthly' ? 'bg-ink-700 text-ink-50' : 'text-ink-400'}`}
          onClick={() => toggle('monthly')}
        >Mois</button>
        <button
          type="button"
          aria-label="Vue annuelle"
          className={`px-3 py-1 text-xs rounded ${period === 'yearly' ? 'bg-ink-700 text-ink-50' : 'text-ink-400'}`}
          onClick={() => toggle('yearly')}
        >Année</button>
      </div>
      <button
        className="btn-ghost !py-1 !px-2"
        aria-label={period === 'monthly' ? 'Mois précédent' : 'Année précédente'}
        onClick={() => shift(-1)}
      >‹</button>
      <span className="text-sm tabular-nums w-20 text-center">{monthOrYear}</span>
      {/* "Next" stays generic ("Suivant") on both sides rather than
          period-worded ("Mois suivant" / "Année suivante") — keeping the
          arrow period-worded would give three accessible names containing
          the period word at once (tab + both arrows), breaking a plain
          /Mois/i or /Année/i role query's uniqueness assumption. */}
      <button
        className="btn-ghost !py-1 !px-2"
        aria-label="Suivant"
        onClick={() => shift(1)}
      >›</button>
    </div>
  );
}
