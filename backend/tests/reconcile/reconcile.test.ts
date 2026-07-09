import { describe, it, expect } from 'vitest';
import { reconcile, renderReconcileSummary, type StatementLine, type ExistingTx } from '../../src/domain/reconcile/reconcile.js';
import { computeDedupKey } from '../../src/domain/imports/dedup.js';

const ACC = 66;
function sline(date: string, amount: string, label: string): StatementLine {
  const normalizedLabel = label.toLowerCase();
  return { date, amount, rawLabel: label, normalizedLabel, dedupKey: computeDedupKey({ accountId: ACC, date, amount, normalizedLabel }) };
}
function etx(id: number, date: string, amount: string, label: string, transferGroupId: string | null = null): ExistingTx {
  const normalizedLabel = label.toLowerCase();
  return { id, date, amount, rawLabel: label, normalizedLabel, dedupKey: computeDedupKey({ accountId: ACC, date, amount, normalizedLabel }), transferGroupId };
}

describe('reconcile', () => {
  it('exact dedupKey match → matched', () => {
    const s = [sline('2025-04-10', '-5.73', 'magasin u')];
    const e = [etx(1, '2025-04-10', '-5.73', 'magasin u')];
    const r = reconcile(s, e);
    expect(r.summary).toMatchObject({ statementLines: 1, matched: 1, missing: 0, mismatched: 0, extra: 0 });
  });

  it('statement line absent from Athena → missing', () => {
    const r = reconcile([sline('2025-04-12', '-18.90', 'fnac')], []);
    expect(r.summary.missing).toBe(1);
    expect(r.missing[0]).toEqual({ date: '2025-04-12', amount: '-18.90', rawLabel: 'fnac' });
  });

  it('same amount+label, date within ±3 days → mismatched date_off (not missing)', () => {
    const s = [sline('2025-04-10', '-5.73', 'magasin u')];
    const e = [etx(9, '2025-04-12', '-5.73', 'magasin u')];
    const r = reconcile(s, e, { dateToleranceDays: 3 });
    expect(r.summary).toMatchObject({ matched: 0, mismatched: 1, missing: 0 });
    expect(r.mismatched[0]).toMatchObject({ reason: 'date_off', athena: { id: 9 } });
  });

  it('same label+date, different amount → mismatched amount_differs', () => {
    const s = [sline('2025-04-05', '-54.00', 'prime')];
    const e = [etx(7, '2025-04-05', '-45.00', 'prime')];
    const r = reconcile(s, e);
    expect(r.mismatched[0]).toMatchObject({ reason: 'amount_differs', statement: { amount: '-54.00' }, athena: { amount: '-45.00' } });
  });

  it('date beyond tolerance → missing, not mismatched', () => {
    const s = [sline('2025-04-10', '-5.73', 'magasin u')];
    const e = [etx(9, '2025-04-20', '-5.73', 'magasin u')];
    const r = reconcile(s, e, { dateToleranceDays: 3 });
    expect(r.summary).toMatchObject({ missing: 1, mismatched: 0 });
  });

  it('Athena row in period not on statement → extra; transfer legs excluded', () => {
    const s = [sline('2025-04-10', '-5.73', 'magasin u')];
    const e = [
      etx(1, '2025-04-10', '-5.73', 'magasin u'),
      etx(2, '2025-04-15', '-99.00', 'erreur'),
      etx(3, '2025-04-16', '-500.00', 'virement interne', 'grp-1'),
    ];
    const r = reconcile(s, e);
    expect(r.summary.extra).toBe(1);
    expect(r.extra[0]).toMatchObject({ id: 2 });
  });

  it('each Athena row is consumed at most once', () => {
    const s = [sline('2025-04-10', '-5.73', 'magasin u'), sline('2025-04-10', '-5.73', 'magasin u')];
    const e = [etx(1, '2025-04-10', '-5.73', 'magasin u')];
    const r = reconcile(s, e);
    expect(r.summary).toMatchObject({ matched: 1, missing: 1 });
  });

  it('period derives from statement min/max date', () => {
    const r = reconcile([sline('2025-04-03', '-1.00', 'a'), sline('2025-04-28', '-2.00', 'b')], []);
    expect(r.statementPeriod).toEqual({ from: '2025-04-03', to: '2025-04-28' });
  });

  it('renderReconcileSummary produces a one-glance line + missing detail', () => {
    const s = [sline('2025-04-12', '-18.90', 'fnac')];
    const r = reconcile(s, []);
    const text = renderReconcileSummary(r, 'Courant');
    expect(text).toContain('Courant');
    expect(text).toContain('1 missing');
    expect(text).toContain('2025-04-12');
  });
});
