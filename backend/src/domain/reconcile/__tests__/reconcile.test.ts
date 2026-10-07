import { describe, it, expect } from 'vitest';
import {
  reconcile,
  renderReconcileSummary,
  type ExistingTx,
  type StatementLine,
} from '../reconcile.js';

const line = (o: Partial<StatementLine> = {}): StatementLine => ({
  date: '2026-03-10',
  amount: '-12.50',
  rawLabel: 'CB CARREFOUR',
  normalizedLabel: 'carrefour',
  dedupKey: 'k1',
  ...o,
});

let nextId = 1;
const tx = (o: Partial<ExistingTx> = {}): ExistingTx => ({
  id: nextId++,
  date: '2026-03-10',
  amount: '-12.50',
  rawLabel: 'CB CARREFOUR',
  normalizedLabel: 'carrefour',
  dedupKey: 'k1',
  transferGroupId: null,
  ...o,
});

describe('reconcile', () => {
  it('matches exact dedupKey lines', () => {
    const r = reconcile([line()], [tx()]);
    expect(r.summary).toEqual({ statementLines: 1, matched: 1, missing: 0, mismatched: 0, extra: 0 });
  });

  it('reports a statement line absent from Athena as missing', () => {
    const r = reconcile([line()], []);
    expect(r.summary.missing).toBe(1);
    expect(r.missing).toEqual([{ date: '2026-03-10', amount: '-12.50', rawLabel: 'CB CARREFOUR' }]);
  });

  it('reports an Athena row absent from the statement as extra', () => {
    const e = tx({ dedupKey: 'zz', normalizedLabel: 'other', date: '2026-03-10' });
    const r = reconcile([line()], [e]);
    expect(r.extra).toEqual([{ id: e.id, date: e.date, amount: e.amount, rawLabel: e.rawLabel }]);
    expect(r.summary.missing).toBe(1);
  });

  it('flags date_off when same label and amount within tolerance', () => {
    const e = tx({ dedupKey: 'other', date: '2026-03-12' });
    const r = reconcile([line()], [e]);
    expect(r.mismatched).toHaveLength(1);
    expect(r.mismatched[0]!.reason).toBe('date_off');
    expect(r.mismatched[0]!.athena.id).toBe(e.id);
    expect(r.summary.extra).toBe(0);
  });

  it('flags amount_differs when same label and close date but other amount', () => {
    const e = tx({ dedupKey: 'other', amount: '-13.50' });
    const r = reconcile([line()], [e]);
    expect(r.mismatched[0]!.reason).toBe('amount_differs');
    expect(r.mismatched[0]!.statement.amount).toBe('-12.50');
    expect(r.mismatched[0]!.athena.amount).toBe('-13.50');
  });

  it('honors the default 3-day tolerance boundary', () => {
    const inside = reconcile([line()], [tx({ dedupKey: 'x', date: '2026-03-13' })]);
    expect(inside.summary.mismatched).toBe(1);
    const outside = reconcile([line()], [tx({ dedupKey: 'x', date: '2026-03-14' })]);
    expect(outside.summary.mismatched).toBe(0);
    expect(outside.summary.missing).toBe(1);
  });

  it('supports a custom dateToleranceDays', () => {
    const e = tx({ dedupKey: 'x', date: '2026-03-12' });
    expect(reconcile([line()], [e], { dateToleranceDays: 1 }).summary.missing).toBe(1);
    expect(reconcile([line()], [e], { dateToleranceDays: 2 }).summary.mismatched).toBe(1);
  });

  it('does not fuzzy-match different labels', () => {
    const e = tx({ dedupKey: 'x', normalizedLabel: 'lidl' });
    const r = reconcile([line()], [e]);
    expect(r.summary.missing).toBe(1);
    expect(r.summary.mismatched).toBe(0);
  });

  it('consumes each existing row at most once', () => {
    const r = reconcile([line(), line()], [tx()]);
    expect(r.summary.matched).toBe(1);
    expect(r.summary.missing).toBe(1);
  });

  it('matches duplicate dedupKeys one-to-one', () => {
    const r = reconcile([line(), line()], [tx(), tx()]);
    expect(r.summary).toMatchObject({ matched: 2, missing: 0, extra: 0 });
  });

  it('lets exact matches win over earlier fuzzy candidates', () => {
    const fuzzyBait = tx({ dedupKey: 'bait', date: '2026-03-11' });
    const exact = tx({ dedupKey: 'k2', date: '2026-03-11' });
    const s1 = line({ dedupKey: 'k2', date: '2026-03-11' });
    const s2 = line({ dedupKey: 'k3', date: '2026-03-11' });
    const r = reconcile([s2, s1], [exact, fuzzyBait]);
    expect(r.summary.matched).toBe(1);
    expect(r.mismatched[0]!.athena.id).toBe(fuzzyBait.id);
  });

  it('excludes rows in a transfer group from extra', () => {
    const e = tx({ dedupKey: 'zz', normalizedLabel: 'virement', transferGroupId: 'g1' });
    const r = reconcile([line()], [e]);
    expect(r.extra).toEqual([]);
  });

  it('bounds extra to the statement period', () => {
    const before = tx({ dedupKey: 'a', normalizedLabel: 'a', date: '2026-03-05' });
    const inside = tx({ dedupKey: 'b', normalizedLabel: 'b', date: '2026-03-10' });
    const after = tx({ dedupKey: 'c', normalizedLabel: 'c', date: '2026-03-20' });
    const r = reconcile([line({ date: '2026-03-08' }), line({ date: '2026-03-12', dedupKey: 'k9' })], [before, inside, after]);
    expect(r.statementPeriod).toEqual({ from: '2026-03-08', to: '2026-03-12' });
    expect(r.extra.map((x) => x.id)).toEqual([inside.id]);
  });

  it('uses explicit from/to over the statement dates', () => {
    const e = tx({ dedupKey: 'a', normalizedLabel: 'a', date: '2026-03-05' });
    const r = reconcile([line()], [e], { from: '2026-03-01', to: '2026-03-31' });
    expect(r.statementPeriod).toEqual({ from: '2026-03-01', to: '2026-03-31' });
    expect(r.extra).toHaveLength(1);
  });

  it('handles an empty statement', () => {
    const r = reconcile([], []);
    expect(r.statementPeriod).toEqual({ from: '', to: '' });
    expect(r.summary).toEqual({ statementLines: 0, matched: 0, missing: 0, mismatched: 0, extra: 0 });
  });

  it('skips fuzzy candidates with unparseable dates', () => {
    const e = tx({ dedupKey: 'x', date: 'garbage' });
    expect(reconcile([line()], [e]).summary.missing).toBe(1);
  });
});

describe('renderReconcileSummary', () => {
  it('renders only the header line when everything matches', () => {
    const r = reconcile([line()], [tx()]);
    const out = renderReconcileSummary(r, 'Compte courant');
    expect(out).toBe('2026-03-10–2026-03-10 · account "Compte courant" — 1 statement lines: 1 matched, 0 missing, 0 mismatch, 0 extra.');
  });

  it('lists missing, mismatch and extra sections and the import hint', () => {
    const missing = line({ rawLabel: 'MISSING ONE', normalizedLabel: 'missing one', dedupKey: 'm', date: '2026-03-10' });
    const mism = line({ dedupKey: 'mm' });
    const r = reconcile(
      [missing, mism],
      [tx({ dedupKey: 'x', amount: '-99.00' }), tx({ dedupKey: 'e', normalizedLabel: 'e', rawLabel: 'EXTRA ONE' })],
    );
    const out = renderReconcileSummary(r, 'A');
    expect(out).toContain('Missing (not in Athena): 2026-03-10 -12.50 MISSING ONE.');
    expect(out).toContain('statement -12.50 vs Athena -99.00 (amount_differs)');
    expect(out).toContain('Extra (in Athena, not on statement): 2026-03-10 -12.50 EXTRA ONE.');
    expect(out).toContain('import this PDF in Athena');
  });

  it('omits the import hint when nothing is missing', () => {
    const r = reconcile([line()], [tx({ dedupKey: 'x', date: '2026-03-11' })]);
    expect(renderReconcileSummary(r, 'A')).not.toContain('import this PDF');
  });
});
