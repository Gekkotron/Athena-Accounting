import { describe, it, expect } from 'vitest';
import PDFDocument from 'pdfkit';
import { extractText } from '../../src/domain/imports/pdf/text-extract.js';

function buildPdf(lines: Array<{ text: string; x: number; y: number }>): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.font('Helvetica').fontSize(10);
    for (const { text, x, y } of lines) {
      doc.text(text, x, y, { lineBreak: false });
    }
    doc.end();
  });
}

describe('extractText', () => {
  it('returns text items with positions from a one-page PDF', async () => {
    const buf = await buildPdf([
      { text: 'BANQUE EXAMPLE', x: 40, y: 40 },
      { text: '15/01/2026', x: 40, y: 200 },
      { text: 'CB CARREFOUR', x: 120, y: 200 },
      { text: '-42,30', x: 480, y: 200 },
    ]);
    const pages = await extractText(buf);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.pageIndex).toBe(0);
    expect(pages[0]!.widthPt).toBeGreaterThan(500);   // A4 = 595pt
    const strs = pages[0]!.items.map((i) => i.str);
    expect(strs).toEqual(expect.arrayContaining(['BANQUE EXAMPLE', '15/01/2026', '-42,30']));
    const date = pages[0]!.items.find((i) => i.str === '15/01/2026')!;
    expect(date.xLeft).toBeGreaterThan(30);
    expect(date.xLeft).toBeLessThan(60);
  });

  it('handles multi-page documents', async () => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks: Buffer[] = [];
    const promise = new Promise<Buffer>((r) => {
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => r(Buffer.concat(chunks)));
    });
    doc.text('Page 1', 40, 40);
    doc.addPage();
    doc.text('Page 2', 40, 40);
    doc.end();
    const buf = await promise;
    const pages = await extractText(buf);
    expect(pages).toHaveLength(2);
    expect(pages[0]!.items[0]!.str).toBe('Page 1');
    expect(pages[1]!.items[0]!.str).toBe('Page 2');
  });
});
