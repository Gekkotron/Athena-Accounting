import { useMemo } from 'react';
import type { PdfImportNeedsTemplate, PdfTextItem } from '../../api/pdf-templates';

// Matches the backend's LINE_Y_TOLERANCE_PT.
const LINE_Y_TOLERANCE_PT = 2;

// Duplicated from backend/src/domain/imports/pdf/page-anchor.ts — same
// heuristic, for the same "is this a French bank account header line?"
// question. Keep in sync with the server-side regex.
const ACCOUNT_HEADER_RE =
  /^(compte(\s|-|$)|c\/c(\s|$)|livret|plan\b|pea(\b|-pme\b)|pel\b|cel\b|lep\b|pep\b|perp\b|epargne|ldds?\b|codevi\b)/i;

interface HeaderCandidate {
  pageIndex: number;
  text: string;      // lowercased, whitespace-normalized — what gets stored
  display: string;   // original casing — what the user sees
  yTop: number;
}

function collectCandidates(needsTemplate: PdfImportNeedsTemplate): HeaderCandidate[] {
  const byPage = new Map<number, PdfTextItem[]>();
  for (const it of needsTemplate.textItems) {
    const arr = byPage.get(it.pageIndex) ?? [];
    arr.push(it);
    byPage.set(it.pageIndex, arr);
  }
  const seen = new Set<string>();
  const out: HeaderCandidate[] = [];
  for (const [pageIndex, items] of byPage) {
    const sorted = [...items].sort((a, b) => a.yTop - b.yTop || a.xLeft - b.xLeft);
    const rows: PdfTextItem[][] = [];
    for (const it of sorted) {
      const last = rows[rows.length - 1];
      if (last && Math.abs(it.yTop - last[0]!.yTop) <= LINE_Y_TOLERANCE_PT) last.push(it);
      else rows.push([it]);
    }
    for (const row of rows) {
      row.sort((a, b) => a.xLeft - b.xLeft);
      const display = row.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
      const text = display.toLowerCase();
      if (!ACCOUNT_HEADER_RE.test(text)) continue;
      if (seen.has(text)) continue;
      seen.add(text);
      out.push({ pageIndex, text, display, yTop: row[0]!.yTop });
    }
  }
  return out.sort((a, b) => a.pageIndex - b.pageIndex || a.yTop - b.yTop);
}

interface Props {
  needsTemplate: PdfImportNeedsTemplate;
  pageAnchor: string | null;
  otherAnchors: string[];
  onPageAnchorChange: (a: string | null) => void;
  onOtherAnchorsChange: (updater: (prev: string[]) => string[]) => void;
}

// Manual anchor picker — a fallback for when the automatic derivation
// misses (e.g. bank uses a header text with an unusual keyword, or the
// mid-page transition isn't captured). Users pick their account's header
// (radio) and any other-account headers on the same pages (checkboxes)
// from a list of candidates that pdfjs already extracted from the sample.
// Nothing picked → backend runs its usual derivation, unchanged.
export function AnchorPickerPanel({
  needsTemplate,
  pageAnchor,
  otherAnchors,
  onPageAnchorChange,
  onOtherAnchorsChange,
}: Props): JSX.Element {
  const candidates = useMemo(() => collectCandidates(needsTemplate), [needsTemplate]);

  if (candidates.length === 0) {
    return (
      <div className="mt-5 pt-4 border-t border-ink-800/60">
        <div className="text-sm text-ink-100 font-medium mb-1">Identifier votre compte</div>
        <p className="text-xs text-ink-400">
          Aucun candidat d'en-tête n'a été détecté sur ce PDF. La détection automatique s'exécutera
          quand même — vous pourrez la vérifier dans la panneau <em>Templates PDF</em> après l'import.
        </p>
      </div>
    );
  }

  const isOther = (text: string) => otherAnchors.includes(text);

  return (
    <div className="mt-5 pt-4 border-t border-ink-800/60">
      <div className="text-sm text-ink-100 font-medium mb-1">
        Identifier votre compte <span className="text-ink-500 font-normal">(optionnel)</span>
      </div>
      <p className="text-xs text-ink-400 mb-3">
        Si la détection automatique se trompe, cochez ici quel en-tête appartient à votre compte,
        et lesquels appartiennent à d'autres comptes du même relevé. Sans sélection, le serveur
        essaie de deviner à partir des pages cochées ci-dessus.
      </p>
      <div className="space-y-1.5">
        {candidates.map((c) => {
          const mine = pageAnchor === c.text;
          const other = isOther(c.text);
          return (
            <div
              key={`${c.pageIndex}-${c.text}`}
              className="flex flex-wrap items-center gap-3 text-xs"
            >
              <span className="text-ink-600 font-mono w-14 shrink-0">p.{c.pageIndex + 1}</span>
              <span className="font-mono text-ink-200 flex-1 min-w-0 truncate" title={c.display}>
                {c.display}
              </span>
              <label className="flex items-center gap-1 cursor-pointer text-ink-400 hover:text-ink-100">
                <input
                  type="radio"
                  name="pageAnchor"
                  className="accent-sage-300"
                  checked={mine}
                  onChange={() => {
                    onPageAnchorChange(c.text);
                    // A line can't be both "mine" and "other".
                    if (other) onOtherAnchorsChange((prev) => prev.filter((a) => a !== c.text));
                  }}
                />
                <span>Le mien</span>
              </label>
              <label className="flex items-center gap-1 cursor-pointer text-ink-400 hover:text-ink-100">
                <input
                  type="checkbox"
                  className="accent-clay-300"
                  disabled={mine}
                  checked={other}
                  onChange={(e) => {
                    onOtherAnchorsChange((prev) =>
                      e.target.checked
                        ? Array.from(new Set([...prev, c.text]))
                        : prev.filter((a) => a !== c.text),
                    );
                  }}
                />
                <span>Autre compte</span>
              </label>
            </div>
          );
        })}
      </div>
      {(pageAnchor || otherAnchors.length > 0) && (
        <button
          type="button"
          className="mt-3 text-[11px] text-ink-500 hover:text-ink-200 underline underline-offset-2"
          onClick={() => {
            onPageAnchorChange(null);
            onOtherAnchorsChange(() => []);
          }}
        >
          Réinitialiser (laisser le serveur deviner)
        </button>
      )}
    </div>
  );
}
