import type { PdfTextItem, PdfPageText } from './text-extract.js';
import type { TemplateZones } from './zones.js';
import { pageContainsAnchor } from './page-anchor.js';

export function flattenItems(pages: PdfPageText[]): PdfTextItem[] {
  return pages.flatMap((p) => p.items);
}

// Explain in one short French sentence WHY the saved template produced 0
// rows on this PDF. Consulted only when we're about to fall back to the
// wizard; the string ends up in a banner above it.
export function diagnoseStaleTemplate(
  pages: PdfPageText[],
  zones: TemplateZones,
  skippedRows: Array<{ rowText: string; reason: string }>,
): string {
  if (zones.pageAnchor && zones.pageAnchor.trim().length > 0) {
    const anchorFoundOn = pages.filter((p) => pageContainsAnchor(p, zones.pageAnchor!)).length;
    if (anchorFoundOn === 0) {
      return `L'ancre du compte « ${zones.pageAnchor} » n'a été trouvée sur aucune des ${pages.length} pages de ce PDF. La mise en page a peut-être changé — cochez la bonne ligne dans "Identifier votre compte" ci-dessous.`;
    }
  }
  const overrunWarning = skippedRows.find((s) => /non traitée/i.test(s.rowText));
  if (overrunWarning) {
    return 'Le template utilise des numéros de page absolus et le PDF est plus court que prévu. Recréez-le pour passer au filtrage par contenu.';
  }
  return 'Le template a été appliqué mais n\'a produit aucune ligne — le tableau, ses colonnes ou les marqueurs d\'autres comptes ne correspondent plus à ce PDF.';
}
