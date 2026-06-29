import { describe, it, expect } from 'vitest';
import PDFDocument from 'pdfkit';
import { renderPagesToPng } from '../../src/domain/imports/pdf/render.js';

function buildTwoPagePdf(): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.fontSize(20).text('Page One', 100, 100);
    doc.addPage();
    doc.fontSize(20).text('Page Two', 100, 100);
    doc.end();
  });
}

describe('renderPagesToPng', () => {
  it('produces one PNG per page at 150 DPI', async () => {
    const buf = await buildTwoPagePdf();
    const pages = await renderPagesToPng(buf);
    expect(pages).toHaveLength(2);
    expect(pages[0]!.pageIndex).toBe(0);
    expect(pages[0]!.widthPt).toBeCloseTo(595, 0);     // A4 width in points
    expect(pages[0]!.pngBase64.length).toBeGreaterThan(1000);
    expect(pages[0]!.pngBase64.startsWith('iVBORw0KGgo')).toBe(true);   // PNG magic in base64
  });
});
