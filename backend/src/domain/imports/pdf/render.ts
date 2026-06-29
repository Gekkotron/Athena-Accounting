import { createCanvas, Path2D, DOMMatrix, ImageData } from '@napi-rs/canvas';

// pdfjs-dist v4 auto-polyfills these globals via CJS require(), but that can
// fail silently in some ESM environments (e.g. vitest). Ensure they are set
// before the lazy pdfjs import runs.
if (!globalThis.Path2D) (globalThis as any).Path2D = Path2D;
if (!globalThis.DOMMatrix) (globalThis as any).DOMMatrix = DOMMatrix;
if (!globalThis.ImageData) (globalThis as any).ImageData = ImageData;

export interface RenderedPage {
  pageIndex: number;
  pngBase64: string;
  widthPt: number;
  heightPt: number;
}

const TARGET_DPI = 150;
const SCALE = TARGET_DPI / 72;       // PDF user space is 72dpi

let pdfjsModule: typeof import('pdfjs-dist/legacy/build/pdf.mjs') | null = null;
async function loadPdfjs() {
  if (!pdfjsModule) pdfjsModule = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsModule;
}

export async function renderPagesToPng(buf: Buffer): Promise<RenderedPage[]> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;

  try {
    const out: RenderedPage[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewportBase = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: SCALE });
      const canvas = createCanvas(viewport.width, viewport.height);
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx as any, viewport }).promise;
      const pngBuf = await canvas.encode('png');
      out.push({
        pageIndex: i - 1,
        pngBase64: pngBuf.toString('base64'),
        widthPt: viewportBase.width,
        heightPt: viewportBase.height,
      });
    }
    return out;
  } finally {
    await doc.destroy();
  }
}
