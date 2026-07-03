import type { PdfPageText, PdfTextItem } from './text-extract.js';

// Two items whose top-Y differs by <= this many points are treated as
// belonging to the same visual line — matches the ROW_Y_TOLERANCE_PT used by
// clusterRows in template-apply.ts.
const LINE_Y_TOLERANCE_PT = 2;

// Below this length, a "line" is too generic to be an anchor (e.g. isolated
// "1", "€", account balance amounts) and would false-match across accounts.
const MIN_ANCHOR_LEN = 4;

// Above this length threshold a candidate line is considered "header-like"
// enough to serve as an `otherAnchor` even without a keyword hint. Short
// lines (< 10 chars) are only accepted when they carry a known
// account-type prefix (compte, livret, pea, …) — see isAccountHeaderLike.
const OTHER_ANCHOR_MIN_LEN = 10;

// Cluster a page's items into visual lines. Returns each line's text
// (lowercase, whitespace-normalized) alongside the top-Y of the row, so
// callers can also decide WHERE on the page a given anchor sits.
export function pageLinesWithY(page: PdfPageText): Array<{ text: string; yTop: number }> {
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
  const out: Array<{ text: string; yTop: number }> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    row.sort((a, b) => a.xLeft - b.xLeft);
    const text = row.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
    if (text.length < MIN_ANCHOR_LEN) continue;
    if (seen.has(text)) continue; // dedupe within a page — keep the FIRST occurrence's Y
    seen.add(text);
    out.push({ text, yTop: row[0]!.yTop });
  }
  return out;
}

// Extract the set of unique lines from a page. A line is one visual row of
// TextItems (yTop within LINE_Y_TOLERANCE_PT of each other), joined by
// spaces, lowercased, whitespace-normalized. Short lines are dropped so we
// don't consider isolated digits/currency symbols as anchors.
export function pageLines(page: PdfPageText): Set<string> {
  return new Set(pageLinesWithY(page).map((l) => l.text));
}

// Heuristic: lines that begin with a French banking account-type keyword
// are almost always account headers ("COMPTE COURANT", "LIVRET A", "PEA
// n°…", "LEP n°…"). Used as a tie-breaker when picking `otherAnchors` so
// header lines beat coincidental long balance strings.
function isAccountHeaderLike(line: string): boolean {
  return /^(compte(\s|$)|livret|plan\b|pea\b|pel\b|cel\b|lep\b|epargne|compte à terme)/i.test(line);
}

// Does this page contain the anchor line? Uses the same lineification as
// deriveAccountAnchor so a page saved as "anchor-bearing" at template
// creation still matches at import time.
export function pageContainsAnchor(page: PdfPageText, anchor: string): boolean {
  const needle = anchor.trim().toLowerCase();
  if (needle.length === 0) return false;
  return pageLines(page).has(needle);
}

// Y-position of the FIRST other-account marker on a page, or null when
// none of the given anchors appear. Used by applyTemplate to cut off row
// processing when a second account begins mid-page.
export function firstOtherAnchorY(page: PdfPageText, otherAnchors: readonly string[]): number | null {
  if (!otherAnchors || otherAnchors.length === 0) return null;
  const needles = new Set(
    otherAnchors.map((a) => a.trim().toLowerCase()).filter((a) => a.length > 0),
  );
  if (needles.size === 0) return null;
  const lines = pageLinesWithY(page);
  let earliest: number | null = null;
  for (const line of lines) {
    if (needles.has(line.text) && (earliest === null || line.yTop < earliest)) {
      earliest = line.yTop;
    }
  }
  return earliest;
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

// Derive markers for OTHER accounts present on the same statement. Used
// to cut off row processing when a page carrying our anchor also contains
// the start of a different account further down. Same signal as
// deriveAccountAnchor, taken from the opposite side of the checkbox
// selection: each unchecked page contributes its most-header-like line,
// and the union across unchecked pages (deduped) is the returned list.
//
// Preference order for each unchecked page's candidate:
//   1. Lines that BEGIN with a French account-type keyword (compte,
//      livret, pea, pel, cel, lep, epargne, plan). These are picked
//      REGARDLESS of whether they also appear on a selected page — the
//      whole point of otherAnchors is to detect a mid-page transition,
//      which by definition places the OTHER account's header ON a
//      selected page too. Filtering those out defeats the mechanism.
//   2. Otherwise, the longest candidate of length >= OTHER_ANCHOR_MIN_LEN
//      that does NOT appear on any selected page. The selected-lines
//      filter still applies here to guard against picking up a repeating
//      footer or page-number that would then falsely cut off future
//      imports.
//
// Returns [] when no distinguishing signal exists — the caller keeps the
// permissive whole-page inclusion path.
export function deriveOtherAccountAnchors(
  pages: PdfPageText[],
  selectedIndices: number[],
): string[] {
  if (pages.length === 0 || selectedIndices.length === 0) return [];
  const selectedSet = new Set(selectedIndices);
  const otherPages = pages.filter((p) => !selectedSet.has(p.pageIndex));
  if (otherPages.length === 0) return [];

  // Lines present anywhere in the selected set — used only to gate the
  // NON-keyword candidate path below.
  const selectedLines = new Set<string>();
  for (const p of pages) {
    if (!selectedSet.has(p.pageIndex)) continue;
    for (const line of pageLines(p)) selectedLines.add(line);
  }

  const collected = new Set<string>();
  for (const page of otherPages) {
    const linesOnPage = Array.from(pageLines(page));
    // Priority 1: keyword headers, no selected-lines filter — the
    // mid-page transition would otherwise be filtered out.
    const headerLike = linesOnPage.filter(isAccountHeaderLike);
    if (headerLike.length > 0) {
      const chosen = headerLike
        .sort((a, b) => b.length - a.length || a.localeCompare(b))[0]!;
      collected.add(chosen);
      continue;
    }
    // Priority 2: long, non-keyword lines. Keep the selected-lines filter
    // so a repeating footer / page number doesn't become a false anchor.
    const uniqueLong = linesOnPage.filter(
      (l) => !selectedLines.has(l) && l.length >= OTHER_ANCHOR_MIN_LEN,
    );
    if (uniqueLong.length > 0) {
      const chosen = uniqueLong
        .sort((a, b) => b.length - a.length || a.localeCompare(b))[0]!;
      collected.add(chosen);
    }
  }
  return Array.from(collected).sort();
}
