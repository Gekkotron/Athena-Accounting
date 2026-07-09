export interface StatementLine {
  date: string; amount: string; rawLabel: string; normalizedLabel: string; dedupKey: string;
}
export interface ExistingTx {
  id: number; date: string; amount: string; rawLabel: string;
  normalizedLabel: string; dedupKey: string; transferGroupId: string | null;
}
export interface ReconcileReport {
  statementPeriod: { from: string; to: string };
  summary: { statementLines: number; matched: number; missing: number; mismatched: number; extra: number };
  missing: Array<{ date: string; amount: string; rawLabel: string }>;
  mismatched: Array<{
    statement: { date: string; amount: string; label: string };
    athena: { id: number; date: string; amount: string; label: string };
    reason: 'date_off' | 'amount_differs';
  }>;
  extra: Array<{ id: number; date: string; amount: string; rawLabel: string }>;
}

function dayDiff(a: string, b: string): number {
  const ms = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function reconcile(
  statement: StatementLine[],
  existing: ExistingTx[],
  opts: { dateToleranceDays?: number; from?: string; to?: string } = {},
): ReconcileReport {
  const tol = opts.dateToleranceDays ?? 3;
  const used = new Set<number>();
  const byDedup = new Map<string, number[]>();
  existing.forEach((e, i) => {
    const arr = byDedup.get(e.dedupKey) ?? [];
    arr.push(i);
    byDedup.set(e.dedupKey, arr);
  });

  let matched = 0;
  const missing: ReconcileReport['missing'] = [];
  const mismatched: ReconcileReport['mismatched'] = [];

  // Pass 1 (exact): give every statement line a chance at an exact dedupKey match
  // before any fuzzy matching runs, so an earlier line's fuzzy match can't steal
  // a row that a later line would have matched exactly.
  const unmatched: StatementLine[] = [];
  for (const s of statement) {
    const exact = (byDedup.get(s.dedupKey) ?? []).find((i) => !used.has(i));
    if (exact !== undefined) { used.add(exact); matched++; continue; }
    unmatched.push(s);
  }

  // Pass 2 (fuzzy): only for lines that didn't match exactly, against whatever
  // existing rows are still unused after all exact matches were consumed.
  for (const s of unmatched) {
    let candIdx = -1;
    let reason: 'date_off' | 'amount_differs' | null = null;
    for (let i = 0; i < existing.length; i++) {
      if (used.has(i)) continue;
      const e = existing[i]!;
      // First-unused-within-tolerance wins; tie-break among multiple candidates is unspecified.
      const dd = dayDiff(s.date, e.date);
      if (Number.isNaN(dd) || Math.abs(dd) > tol) continue;
      if (e.normalizedLabel !== s.normalizedLabel) continue;
      if (e.amount === s.amount) { candIdx = i; reason = 'date_off'; break; }        // same amount+label, off by days
      candIdx = i; reason = 'amount_differs'; break;                                  // same label+date-ish, amount differs
    }
    if (candIdx >= 0 && reason) {
      used.add(candIdx);
      const e = existing[candIdx]!;
      mismatched.push({
        statement: { date: s.date, amount: s.amount, label: s.rawLabel },
        athena: { id: e.id, date: e.date, amount: e.amount, label: e.rawLabel },
        reason,
      });
      continue;
    }
    missing.push({ date: s.date, amount: s.amount, rawLabel: s.rawLabel });
  }

  const dates = statement.map((s) => s.date).sort();
  const from = opts.from ?? dates[0] ?? '';
  const to = opts.to ?? dates[dates.length - 1] ?? '';

  const extra = existing
    .map((e, i) => ({ e, i }))
    .filter(({ e, i }) => !used.has(i) && e.transferGroupId === null)
    .map(({ e }) => ({ id: e.id, date: e.date, amount: e.amount, rawLabel: e.rawLabel }));

  return {
    statementPeriod: { from, to },
    summary: { statementLines: statement.length, matched, missing: missing.length, mismatched: mismatched.length, extra: extra.length },
    missing, mismatched, extra,
  };
}

export function renderReconcileSummary(report: ReconcileReport, accountName: string): string {
  const { summary: s, statementPeriod: p } = report;
  const lines: string[] = [];
  lines.push(
    `${p.from}–${p.to} · account "${accountName}" — ${s.statementLines} statement lines: ` +
    `${s.matched} matched, ${s.missing} missing, ${s.mismatched} mismatch, ${s.extra} extra.`,
  );
  if (report.missing.length) {
    lines.push('Missing (not in Athena): ' + report.missing.map((m) => `${m.date} ${m.amount} ${m.rawLabel}`).join('; ') + '.');
  }
  if (report.mismatched.length) {
    lines.push('Mismatch: ' + report.mismatched.map((m) => `${m.statement.date} ${m.statement.label} — statement ${m.statement.amount} vs Athena ${m.athena.amount} (${m.reason})`).join('; ') + '.');
  }
  if (report.extra.length) {
    lines.push('Extra (in Athena, not on statement): ' + report.extra.map((e) => `${e.date} ${e.amount} ${e.rawLabel}`).join('; ') + '.');
  }
  if (s.missing > 0) {
    lines.push('To add the missing transactions, import this PDF in Athena — dedup will insert only these and skip the rest.');
  }
  return lines.join('\n');
}
