import type { PdfPageText, PdfTextItem } from './text-extract.js';

// Two items whose top-Y differs by <= this many points are treated as
// belonging to the same visual line — matches the ROW_Y_TOLERANCE_PT used by
// clusterRows in template-apply.ts.
const LINE_Y_TOLERANCE_PT = 2;

// Below this length, a "line" is too generic to be an anchor (e.g. isolated
// "1", "€", account balance amounts) and would false-match across accounts.
const MIN_ANCHOR_LEN = 4;

// Extract the set of unique lines from a page. A line is one visual row of
// TextItems (yTop within LINE_Y_TOLERANCE_PT of each other), joined by
// spaces, lowercased, whitespace-normalized. Short lines are dropped so we
// don't consider isolated digits/currency symbols as anchors.
export function pageLines(page: PdfPageText): Set<string> {
  const sorted = [...page.items].sort((a, b) => a.yTop - b.yTop);
  const rows: PdfTextItem[][] = [];
  for (const it of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(it.yTop - last[0]!.yTop) <= LINE_Y_TOLERANCE_PT) {
      last.push(it);
    } else {
      rows.push([it]);
    }
  }
  const out = new Set<string>();
  for (const row of rows) {
    row.sort((a, b) => a.xLeft - b.xLeft);
    const text = row.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
    if (text.length >= MIN_ANCHOR_LEN) out.add(text);
  }
  return out;
}

// Does this page contain the anchor line? Uses the same lineification as
// deriveAccountAnchor so a page saved as "anchor-bearing" at template
// creation still matches at import time.
export function pageContainsAnchor(page: PdfPageText, anchor: string): boolean {
  const needle = anchor.trim().toLowerCase();
  if (needle.length === 0) return false;
  return pageLines(page).has(needle);
}

// Derive a text anchor that identifies the account's pages.
//
// Given the extracted pages and the indices the user marked as "belonging to
// this account", return the longest line that appears on every selected page
// and no unselected page. Bank statements typically repeat an account header
// on each page of that account ("compte courant n° …", "livret a n° …"), so
// this pins the account by content rather than by absolute page number.
//
// Returns null when:
//   - no page is selected, or every page is selected (nothing to distinguish);
//   - no line meets the shared-by-all-selected AND absent-from-all-others
//     criteria (rare — the caller should fall back to storing selectedPages
//     and warn the user).
export function deriveAccountAnchor(
  pages: PdfPageText[],
  selectedIndices: number[],
): string | null {
  if (selectedIndices.length === 0) return null;
  const selectedSet = new Set(selectedIndices);
  const selectedPages = pages.filter((p) => selectedSet.has(p.pageIndex));
  const otherPages = pages.filter((p) => !selectedSet.has(p.pageIndex));
  if (selectedPages.length === 0) return null;
  if (otherPages.length === 0) return null; // nothing to distinguish

  // Intersection of lines shared by every selected page.
  const perPageLines = selectedPages.map(pageLines);
  let common = new Set<string>(perPageLines[0]!);
  for (let i = 1; i < perPageLines.length; i++) {
    const next = new Set<string>();
    for (const line of common) {
      if (perPageLines[i]!.has(line)) next.add(line);
    }
    common = next;
    if (common.size === 0) return null;
  }

  // Filter: drop any line that also appears on an unselected page.
  const otherLineSets = otherPages.map(pageLines);
  const survivors: string[] = [];
  outer: for (const line of common) {
    for (const other of otherLineSets) {
      if (other.has(line)) continue outer;
    }
    survivors.push(line);
  }
  if (survivors.length === 0) return null;

  // Longest surviving line is the most specific anchor; ties broken by
  // lexicographic order for determinism.
  survivors.sort((a, b) => b.length - a.length || a.localeCompare(b));
  return survivors[0]!;
}
