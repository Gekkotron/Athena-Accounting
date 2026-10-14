import type { Account, Transaction } from '../../../types';
import type { DemoAccountValuation, DemoState } from '../../store';

// Demo mirror of backend/src/domain/investments/gain.ts + list.ts: Valeur,
// Versé and plus-value for one account. `book` is the book balance
// (opening + counted transactions). Versé excludes income-kind transactions;
// it is only defined for investment|savings accounts.
export function valuationFields(
  acc: Account,
  book: number,
  counted: Transaction[],
  state: DemoState,
  today: string,
): Pick<Account, 'contributed' | 'latestValue' | 'latestValueDate' | 'value' | 'gain' | 'gainPct'> {
  const fmt = (n: number) => (n < 0 ? '-' : '') + Math.abs(n).toFixed(2);
  const isInvestment = acc.type === 'investment';
  const tracksGain = isInvestment || acc.type === 'savings';
  const latest = isInvestment
    ? (state.accountValuations ?? [])
        .filter((v: DemoAccountValuation) => v.accountId === acc.id && v.date <= today)
        .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null
    : null;
  const valueNum = latest ? Number(latest.value) : book;
  const base = {
    latestValue: latest?.value ?? null,
    latestValueDate: latest?.date ?? null,
    value: fmt(valueNum),
  };
  if (!tracksGain) return { ...base, contributed: null, gain: null, gainPct: null };
  const incomeIds = new Set(state.categories.filter((c) => c.kind === 'income').map((c) => c.id));
  const contributed = counted.reduce(
    (s, t) => (t.categoryId != null && incomeIds.has(t.categoryId) ? s : s + Number(t.amount)),
    Number(acc.openingBalance),
  );
  const gain = valueNum - contributed;
  return {
    ...base,
    contributed: fmt(contributed),
    gain: fmt(gain),
    gainPct: contributed > 0 ? gain / contributed : null,
  };
}
