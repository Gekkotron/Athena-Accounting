import { createWorker, type Worker } from 'tesseract.js';

export interface OcrWord {
  pageIndex: number; str: string;
  xLeft: number; yTop: number; width: number; height: number;
  confidence: number;
}
export interface OcrPage {
  pageIndex: number; widthPx: number; heightPx: number;
  words: OcrWord[]; meanConfidence: number;
}

function readPngDims(buf: Buffer): { widthPx: number; heightPx: number } {
  // PNG signature check
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) {
    throw new Error('OCR input is not a PNG');
  }
  // IHDR chunk starts at byte 8; type at bytes 12-15 must be 'IHDR' = 0x49484452
  if (buf.readUInt32BE(12) !== 0x49484452) {
    throw new Error('OCR input PNG missing IHDR chunk');
  }
  return { widthPx: buf.readUInt32BE(16), heightPx: buf.readUInt32BE(20) };
}

export async function ocrPngPages(
  pngBase64Pages: string[],
  opts: {
    lang?: 'fra' | 'eng' | 'fra+eng';
    onPageDone?: (pageIndex: number, total: number) => void;
  } = {},
): Promise<OcrPage[]> {
  const lang = opts.lang ?? 'fra+eng';
  // In LAN-only/offline deploy, set OCR_LANG_PATH to a directory containing
  // fra.traineddata and eng.traineddata (both ~30 MB). Without it, tesseract.js
  // fetches from a CDN on first use — acceptable for dev, breaks in prod.
  const worker: Worker = await createWorker(
    lang,
    1,
    process.env.OCR_LANG_PATH ? { langPath: process.env.OCR_LANG_PATH } : undefined,
  );
  try {
    const out: OcrPage[] = [];
    for (let i = 0; i < pngBase64Pages.length; i++) {
      const b64 = pngBase64Pages[i]!;
      const buf = Buffer.from(b64, 'base64');
      const { widthPx, heightPx } = readPngDims(buf);
      const { data } = await worker.recognize(buf);
      // tesseract.js v5 result: data.words = [{ text, bbox: { x0, y0, x1, y1 }, confidence }]
      const words: OcrWord[] = [];
      let confSum = 0;
      let confCount = 0;
      for (const w of data.words ?? []) {
        // Skip whitespace-only tokens tesseract sometimes emits.
        const text = (w.text ?? '').trim();
        if (!text) continue;
        const bbox = w.bbox;
        words.push({
          pageIndex: i,
          str: text,
          xLeft: bbox.x0,
          yTop: bbox.y0,
          width: bbox.x1 - bbox.x0,
          height: bbox.y1 - bbox.y0,
          confidence: (w.confidence ?? 0) / 100,
        });
        confSum += (w.confidence ?? 0) / 100;
        confCount += 1;
      }
      out.push({
        pageIndex: i, widthPx, heightPx, words,
        meanConfidence: confCount === 0 ? 0 : confSum / confCount,
      });
      opts.onPageDone?.(i, pngBase64Pages.length);
    }
    return out;
  } finally {
    await worker.terminate();
  }
}
