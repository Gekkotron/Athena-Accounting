import { extractText, type PdfTextItem, type PdfPageText } from './text-extract.js';
import { readPngDims } from '../ocr/index.js';

// Rebuild PdfPageText[] from a draft row. Photos and OCR-processed PDFs
// use the stored text_items (written at OCR completion) rather than
// re-running pdfjs on the raw bytes — pdfjs would either refuse a PNG
// ("Invalid PDF structure") or return empty items on a text-less PDF.
export async function hydrateDraftPages(draft: {
  pdfBytes: string;
  textItems: unknown;
  sourceKind: string;
  ocrStatus: string;
}): Promise<PdfPageText[]> {
  const b64 = draft.pdfBytes;
  const buf = Buffer.from(b64, 'base64');
  const stored = (draft.textItems ?? []) as PdfTextItem[];
  const itemsByPage = new Map<number, PdfTextItem[]>();
  for (const it of stored) {
    const arr = itemsByPage.get(it.pageIndex) ?? [];
    arr.push(it);
    itemsByPage.set(it.pageIndex, arr);
  }
  if (draft.sourceKind === 'photo') {
    const { widthPx, heightPx } = readPngDims(buf);
    return [{
      pageIndex: 0,
      widthPt: widthPx,
      heightPt: heightPx,
      items: itemsByPage.get(0) ?? [],
    }];
  }
  // PDF path — extractText yields the correct page dims. Its own items
  // are empty on a text-less PDF, so if OCR ran we override them with
  // the stored (already rescaled to points) text_items.
  const extracted = await extractText(buf);
  if (draft.ocrStatus === 'ready') {
    return extracted.map((p) => ({
      ...p,
      items: itemsByPage.get(p.pageIndex) ?? [],
    }));
  }
  return extracted;
}

export function draftExpiredError(): Error {
  const err = new Error('draft_expired');
  (err as { code?: string }).code = 'draft_expired';
  return err;
}
