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
// header lines beat coincidental long balance strings. The list covers
// the terms French banks actually print in statement headers, including
// the "c/c" abbreviation (Compte Courant), the more specific PEA/PEP
// variants, and the Livret family sub-types.
function isAccountHeaderLike(line: string): boolean {
  return /^(compte(\s|-|$)|c\/c(\s|$)|livret|plan\b|pea(\b|-pme\b)|pel\b|cel\b|lep\b|pep\b|perp\b|epargne|ldds?\b|codevi\b)/i.test(line);
}

// Build a "flat text" view of a page: every TextItem's string concatenated
// in reading order (yTop then xLeft), separated by single spaces, lowercased
// and whitespace-normalized. Also returns a parallel array mapping each
// character index in the flat text to its source item's index (so a
// substring hit can be resolved back to a yTop). Robust to line
// fragmentation (pdfjs sometimes splits a visual line into multiple items
// on slightly-different baselines — that would defeat the lineified
// matching but is invisible to the flat view).
export interface FlatPageText {
  flat: string;
  charToItem: number[];
  sorted: PdfTextItem[];
}

export function pageFlatText(page: PdfPageText): FlatPageText {
  const sorted = [...page.items].sort((a, b) => a.yTop - b.yTop || a.xLeft - b.xLeft);
  let flat = '';
  const charToItem: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const chunk = sorted[i]!.str.trim().replace(/\s+/g, ' ').toLowerCase();
    if (chunk.length === 0) continue;
    if (flat.length > 0) {
      flat += ' ';
      charToItem.push(i); // attribute the separator to the following item
    }
    for (let c = 0; c < chunk.length; c++) charToItem.push(i);
    flat += chunk;
  }
  return { flat, charToItem, sorted };
}

// Extract the STABLE portion of a stored anchor — typically the "n°
// <digits>" account-number substring. Banks tweak marketing wording
// between statements ("C/C CONTRAT PERSONNEL" → "COMPTE COURANT PRIVE")
// while keeping the account number. If a stored anchor's exact text
// isn't found on the imported PDF, we fall back to searching for just
// this stable substring so the template keeps working.
//
// Returns null when no account-number pattern is present in the anchor —
// in that case there's no safe fallback and the caller reports "no match".
export function extractStableAnchor(anchor: string): string | null {
  // "n°" / "n˚" / "nº" / "no " prefix, then 5+ digits. The prefix is
  // load-bearing: matching a raw digit run risks false-positives on
  // dates, amounts, or unrelated numbers that happen to appear in the
  // flat text.
  const m = anchor.match(/n[°˚º]\s*\d{5,}/i);
  return m ? m[0].toLowerCase().replace(/\s+/g, ' ') : null;
}

// yTop of the FIRST occurrence of `anchor` within a page's flat text, or
// null when the anchor doesn't appear anywhere on the page. The anchor
// itself is trimmed + lowercased + whitespace-collapsed before lookup so a
// stored line like "livret a n° 98765" still matches when pdfjs happens
// to split it across multiple items on the incoming PDF. If the exact
// anchor isn't found, retries with the extracted stable substring (see
// extractStableAnchor).
export function anchorYInFlat(flat: FlatPageText, anchor: string): number | null {
  const needle = anchor.trim().replace(/\s+/g, ' ').toLowerCase();
  if (needle.length === 0) return null;
  let idx = flat.flat.indexOf(needle);
  if (idx < 0) {
    const stable = extractStableAnchor(anchor);
    if (stable) idx = flat.flat.indexOf(stable);
    if (idx < 0) return null;
  }
  const itemIdx = flat.charToItem[idx];
  if (itemIdx === undefined || itemIdx < 0) return null;
  return flat.sorted[itemIdx]!.yTop;
}

// Does this page contain the anchor line? Uses flat-text scanning so a
// visual line fragmented into multiple TextItems on the imported PDF still
// matches an anchor stored as a joined string.
export function pageContainsAnchor(page: PdfPageText, anchor: string): boolean {
  return anchorYInFlat(pageFlatText(page), anchor) !== null;
}

// Y-position of the FIRST other-account marker on a page, or null when
// none of the given anchors appear. Used by applyTemplate to cut off row
// processing when a second account begins mid-page. Scans flat text so
// fragmented headers still match.
export function firstOtherAnchorY(page: PdfPageText, otherAnchors: readonly string[]): number | null {
  if (!otherAnchors || otherAnchors.length === 0) return null;
  const flat = pageFlatText(page);
  let earliest: number | null = null;
  for (const a of otherAnchors) {
    const y = anchorYInFlat(flat, a);
    if (y !== null && (earliest === null || y < earliest)) earliest = y;
  }
  return earliest;
}

// Frequency-based anchor pick. Counts every account-header-like line
// (any page, checked or not) and returns the one that appears on the
// MOST pages. On real bank statements the primary account's header
// repeats on every one of its pages, so a most-frequent line is very
// likely that account's marker. Ties broken by longer line first
// (more specific), then lex order.
//
// Used as a fallback when the intersection-based derivation returns
// null — most commonly when the user checked every sample page, so
// there's no "unchecked" set to distinguish from.
function deriveAnchorByFrequency(pages: PdfPageText[]): string | null {
  const freq = new Map<string, number>();
  for (const p of pages) {
    for (const line of pageLines(p)) {
      if (!isAccountHeaderLike(line)) continue;
      freq.set(line, (freq.get(line) ?? 0) + 1);
    }
  }
  if (freq.size === 0) return null;
  const sorted = Array.from(freq.entries()).sort(
    (a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]),
  );
  return sorted[0]![0];
}

// Derive a text anchor that identifies the account's pages.
//
// Given the extracted pages and the indices the user marked as "belonging to
// this account", return the longest line that appears on every selected page
// and no unselected page. Bank statements typically repeat an account header
// on each page of that account ("compte courant n° …", "livret a n° …"), so
// this pins the account by content rather than by absolute page number.
//
// Falls back to the most-frequent account-header line across all pages when
// the intersection-based path yields nothing — critical when the user
// selected every sample page (default state, no unchecked set to key on).
// Returns null only when no candidate header can be found anywhere.
export function deriveAccountAnchor(
  pages: PdfPageText[],
  selectedIndices: number[],
): string | null {
  if (selectedIndices.length === 0) return null;
  const selectedSet = new Set(selectedIndices);
  const selectedPages = pages.filter((p) => selectedSet.has(p.pageIndex));
  const otherPages = pages.filter((p) => !selectedSet.has(p.pageIndex));
  if (selectedPages.length === 0) return null;

  // Intersection-based path only applies when there's an unchecked set
  // to distinguish selected from. Otherwise (all pages selected) fall
  // straight through to the frequency-based picker.
  if (otherPages.length > 0) {
    const perPageLines = selectedPages.map(pageLines);
    let common = new Set<string>(perPageLines[0]!);
    for (let i = 1; i < perPageLines.length; i++) {
      const next = new Set<string>();
      for (const line of common) {
        if (perPageLines[i]!.has(line)) next.add(line);
      }
      common = next;
      if (common.size === 0) break;
    }
    if (common.size > 0) {
      const otherLineSets = otherPages.map(pageLines);
      const survivors: string[] = [];
      outer: for (const line of common) {
        for (const other of otherLineSets) {
          if (other.has(line)) continue outer;
        }
        survivors.push(line);
      }
      if (survivors.length > 0) {
        survivors.sort((a, b) => b.length - a.length || a.localeCompare(b));
        return survivors[0]!;
      }
    }
  }

  // Fallback — frequency-based across ALL pages. Works even with every
  // page selected: on a Compte-Courant + Livret-A statement the Compte
  // Courant header appears on 3 pages, Livret A on 1, and frequency
  // picks Compte Courant.
  return deriveAnchorByFrequency(selectedPages);
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
  pageAnchor: string | null = null,
  rowsStartY: number = 0,
): string[] {
  if (pages.length === 0 || selectedIndices.length === 0) return [];
  const selectedSet = new Set(selectedIndices);
  const otherPages = pages.filter((p) => !selectedSet.has(p.pageIndex));
  const collected = new Set<string>();

  // --- Path A: from UNCHECKED pages ----------------------------------------
  // Catches other accounts that have their own dedicated pages.
  if (otherPages.length > 0) {
    // Lines present anywhere in the selected set — used only to gate the
    // NON-keyword candidate path below.
    const selectedLines = new Set<string>();
    for (const p of pages) {
      if (!selectedSet.has(p.pageIndex)) continue;
      for (const line of pageLines(p)) selectedLines.add(line);
    }
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
      // Priority 2: long, non-keyword lines. Keep the selected-lines
      // filter so a repeating footer / page number doesn't become a
      // false anchor.
      const uniqueLong = linesOnPage.filter(
        (l) => !selectedLines.has(l) && l.length >= OTHER_ANCHOR_MIN_LEN,
      );
      if (uniqueLong.length > 0) {
        const chosen = uniqueLong
          .sort((a, b) => b.length - a.length || a.localeCompare(b))[0]!;
        collected.add(chosen);
      }
    }
  }

  // --- Path B: from SELECTED pages, below the account's own anchor ---------
  // Catches mid-page transitions where the "other" account fits entirely
  // on a page that also carries our own account (so the whole statement
  // has no unchecked pages to scan from Path A). Only lines BELOW the
  // anchor's yTop AND at-or-below the transaction table's start Y are
  // considered — anything above rowsStartY would be page-header
  // decoration (e.g. a "COMPTE Détails" label sitting between our
  // anchor and the first row), and using it as a cutoff would shrink
  // the row window to zero.
  const own = (pageAnchor ?? '').trim().toLowerCase();
  if (own.length > 0) {
    for (const p of pages) {
      if (!selectedSet.has(p.pageIndex)) continue;
      const lines = pageLinesWithY(p);
      const anchorLine = lines.find((l) => l.text === own);
      if (!anchorLine) continue;
      for (const line of lines) {
        if (line.yTop <= anchorLine.yTop) continue;
        if (line.yTop <= rowsStartY) continue;
        if (line.text === own) continue;
        if (isAccountHeaderLike(line.text)) collected.add(line.text);
      }
    }
  }

  return Array.from(collected).sort();
}
