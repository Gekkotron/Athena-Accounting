// The "end-of-day" row for a date is that date's chronologically-last
// transaction — the one with the greatest id (running balance is computed by
// date,id ascending, so the max-id row of a date carries the end-of-day
// balance). A balance checkpoint is unique per (account, date), so only these
// rows get the "validate balance" checkbox.
//
// NOTE: computed over the currently-rendered page. A single date split across a
// page boundary can therefore resolve its end-of-day row per page; acceptable
// at 50 rows/page with few transactions per day.
export function endOfDayRowIds(rows: { id: number; date: string }[]): Set<number> {
  const maxByDate = new Map<string, number>();
  for (const r of rows) {
    const cur = maxByDate.get(r.date);
    if (cur === undefined || r.id > cur) maxByDate.set(r.date, r.id);
  }
  return new Set(maxByDate.values());
}

// Whether the active filters keep each visible day COMPLETE. Checkpoints
// anchor to a date's true last transaction; filters that punch holes inside
// a day (text search, amount search, category, source file) can promote a
// mid-day row to "end of day" in the filtered view — its running balance is
// still correct (the backend computes it over the full history), but it is
// not the end-of-day amount a checkpoint froze, so the drift warning would
// fire falsely and toggling the pin would freeze a mid-day amount. Date
// range and account filters remove whole days, never rows within a day, so
// they stay checkpoint-compatible.
export function hasCompleteDays(filters: {
  search?: string;
  amount?: string;
  categoryId?: number;
  sourceFileId?: number;
}): boolean {
  return (
    !filters.search &&
    !filters.amount &&
    filters.categoryId == null &&
    filters.sourceFileId == null
  );
}
