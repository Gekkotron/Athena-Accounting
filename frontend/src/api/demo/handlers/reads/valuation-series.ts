import { addDaysIso, bucketFor, txs } from './lib';

// Demo mirror of the backend's Valeur series for one investment account
// (GET /api/reports/timeseries?withGains=1). Versé excludes income-kind
// transactions; the gain is linearly interpolated between valuations
// (carried after the last, book balance before the first). A bucket keeps its
// last day's value. Returns one dense row per bucket from the opening date to
// `to`.
export function valuationSeries(
  acc: { id: number; openingDate: string; openingBalance: string },
  incomeIds: Set<number>,
  valuations: Array<{ date: string; value: number }>,
  to: string,
  granularity: 'day' | 'week' | 'month',
): Array<{ bucket: string; value: number }> {
  const book = new Map<string, number>();
  const contrib = new Map<string, number>();
  for (const t of txs()) {
    if (t.accountId !== acc.id || t.date < acc.openingDate) continue;
    const amt = Number(t.amount);
    book.set(t.date, (book.get(t.date) ?? 0) + amt);
    if (!(t.categoryId != null && incomeIds.has(t.categoryId))) contrib.set(t.date, (contrib.get(t.date) ?? 0) + amt);
  }
  let cumBook = Number(acc.openingBalance);
  let cumContrib = cumBook;
  // Day-indexed running sums so anchors can read Versé at their date.
  const days: Array<{ date: string; book: number; contrib: number }> = [];
  for (let d = acc.openingDate; d <= to; d = addDaysIso(d, 1)) {
    cumBook += book.get(d) ?? 0;
    cumContrib += contrib.get(d) ?? 0;
    days.push({ date: d, book: cumBook, contrib: cumContrib });
  }
  const byDate = new Map(days.map((x) => [x.date, x]));
  const anchors = valuations
    .filter((v) => byDate.has(v.date))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((v) => ({ date: v.date, value: v.value, gain: v.value - byDate.get(v.date)!.contrib }));
  const buckets = new Map<string, number>();
  for (const day of days) {
    const prev = [...anchors].reverse().find((a) => a.date <= day.date);
    const next = anchors.find((a) => a.date > day.date);
    let value = day.book;
    if (prev) {
      let gain = prev.gain;
      if (next) {
        const span = (Date.parse(next.date) - Date.parse(prev.date)) / 86_400_000;
        const at = (Date.parse(day.date) - Date.parse(prev.date)) / 86_400_000;
        gain += ((next.gain - prev.gain) * at) / span;
      }
      value = prev.date === day.date ? prev.value : day.contrib + gain;
    }
    buckets.set(bucketFor(day.date, granularity), value);
  }
  return [...buckets.entries()].map(([bucket, value]) => ({ bucket, value }));
}
