// pdfjs-dist ships an ESM "legacy" build that runs in plain Node without a DOM.
// We import it lazily because the module does its own globalThis poking on first
// require and we want server startup to remain cheap.
import type { TextItem } from 'pdfjs-dist/types/src/display/api.d.ts';

export interface PdfTextItem {
  pageIndex: number;
  str: string;
  xLeft: number;
  yTop: number;
  width: number;
  height: number;
}

export interface PdfPageText {
  pageIndex: number;
  widthPt: number;
  heightPt: number;
  items: PdfTextItem[];
}

let pdfjsModule: typeof import('pdfjs-dist/legacy/build/pdf.mjs') | null = null;
async function loadPdfjs() {
  if (!pdfjsModule) {
    pdfjsModule = await import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsModule;
}

export async function extractText(buf: Buffer): Promise<PdfPageText[]> {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(buf);

  let doc;
  try {
    doc = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
  } catch (err: any) {
    if (err?.name === 'PasswordException') throw new PdfEncryptedError('PDF is password-protected');
    throw err;
  }

  try {
    const pages: PdfPageText[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();

      const items: PdfTextItem[] = [];
      for (const raw of content.items) {
        if (!('str' in raw)) continue;
        const item = raw as TextItem;
        // transform = [a, b, c, d, e, f]. e = x in pdf user space (origin
        // bottom-left). f = y baseline. Convert to top-left origin so the
        // heuristic's "row Y" intuition matches what the user sees on screen.
        const [, , , , e, f] = item.transform;
        const yTop = viewport.height - f - item.height;
        items.push({
          pageIndex: i - 1,
          str: item.str,
          xLeft: e,
          yTop,
          width: item.width,
          height: item.height,
        });
      }
      pages.push({
        pageIndex: i - 1,
        widthPt: viewport.width,
        heightPt: viewport.height,
        items,
      });
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}

export class PdfEncryptedError extends Error {
  code = 'pdf_encrypted' as const;
}
