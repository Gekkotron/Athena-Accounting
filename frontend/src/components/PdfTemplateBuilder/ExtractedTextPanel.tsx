import { useMemo } from 'react';
import type { PdfTextItem, PdfImportNeedsTemplate } from '../../api/pdf-templates';

// Two items whose yTop differs by <= this many points are grouped into
// the same visual line — matches the backend's LINE_Y_TOLERANCE_PT.
const LINE_Y_TOLERANCE_PT = 2;

// French banking account-type keywords the backend uses to spot account
// headers. Duplicated here just for the debug view's highlighting; the
// authoritative regex lives in backend/src/domain/imports/pdf/page-anchor.ts
// and is what actually decides the anchor + otherAnchors at save time.
const ACCOUNT_HEADER_RE =
  /^(compte(\s|-|$)|c\/c(\s|$)|livret|plan\b|pea(\b|-pme\b)|pel\b|cel\b|lep\b|pep\b|perp\b|epargne|ldds?\b|codevi\b)/i;

interface Line {
  text: string;
  yTop: number;
  looksLikeHeader: boolean;
}

function lineifyPage(items: PdfTextItem[]): Line[] {
  const sorted = [...items].sort((a, b) => a.yTop - b.yTop || a.xLeft - b.xLeft);
  const rows: PdfTextItem[][] = [];
  for (const it of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(it.yTop - last[0]!.yTop) <= LINE_Y_TOLERANCE_PT) {
      last.push(it);
    } else {
      rows.push([it]);
    }
  }
  return rows.map((row) => {
    row.sort((a, b) => a.xLeft - b.xLeft);
    const text = row.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
    return { text, yTop: row[0]!.yTop, looksLikeHeader: ACCOUNT_HEADER_RE.test(text) };
  }).filter((l) => l.text.length > 0);
}

// Read-only "what pdfjs actually returned" view for a template-build
// session. Users can crack open this panel to see the extracted text of
// each page, with account-header-like lines highlighted — so when the
// automatic derivation misses, they know why (a stray whitespace, a
// missing keyword) instead of guessing.
export function ExtractedTextPanel({
  needsTemplate,
}: {
  needsTemplate: PdfImportNeedsTemplate;
}): JSX.Element {
  const linesPerPage = useMemo(() => {
    const byPage = new Map<number, PdfTextItem[]>();
    for (const it of needsTemplate.textItems) {
      const arr = byPage.get(it.pageIndex) ?? [];
      arr.push(it);
      byPage.set(it.pageIndex, arr);
    }
    return needsTemplate.pages.map((p) => ({
      pageIndex: p.pageIndex,
      lines: lineifyPage(byPage.get(p.pageIndex) ?? []),
    }));
  }, [needsTemplate.textItems, needsTemplate.pages]);

  return (
    <details className="mt-4 rounded-lg border border-ink-800/60 bg-ink-950/40 text-xs">
      <summary className="cursor-pointer px-3 py-2 text-ink-300 hover:text-ink-100">
        Voir le texte extrait (diagnostic)
      </summary>
      <div className="px-3 pb-3 pt-1 max-h-96 overflow-auto font-mono">
        <p className="mb-2 text-[11px] text-ink-500 leading-relaxed">
          Ce que pdfjs a extrait du PDF, page par page. Les lignes surlignées ressemblent à un
          en-tête de compte (heuristique côté serveur) et deviennent candidates pour le
          marqueur du compte / autres comptes.
        </p>
        {linesPerPage.map(({ pageIndex, lines }) => (
          <div key={pageIndex} className="mb-3 last:mb-0">
            <div className="text-ink-500 mb-1">— Page {pageIndex + 1} — {lines.length} ligne(s)</div>
            <ul className="space-y-0.5">
              {lines.map((l, i) => (
                <li
                  key={i}
                  className={l.looksLikeHeader ? 'text-sage-300' : 'text-ink-300'}
                  title={`yTop=${l.yTop.toFixed(1)}`}
                >
                  {l.text}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}
