import { describe, it, expect } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { ocrPngPages } from '../index.js';

function renderPngWithText(text: string, width = 400, height = 60): string {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'black';
  ctx.font = '24px sans-serif';
  ctx.fillText(text, 10, 40);
  return canvas.toBuffer('image/png').toString('base64');
}

describe('ocrPngPages', () => {
  it('recognizes rendered text on a single page', async () => {
    const png = renderPngWithText('2026-06-14 CARREFOUR -34,20');
    const [page] = await ocrPngPages([png]);
    expect(page).toBeDefined();
    const joined = page!.words.map((w) => w.str).join(' ');
    expect(joined).toMatch(/2026-06-14/);
    expect(joined).toMatch(/CARREFOUR/);
    expect(page!.meanConfidence).toBeGreaterThan(0.4);
    expect(page!.words[0]!.confidence).toBeGreaterThanOrEqual(0);
    expect(page!.words[0]!.confidence).toBeLessThanOrEqual(1);
  }, 60_000); // Tesseract cold-start is slow: worker init + fra+eng load.

  it('emits an empty word list for a blank page', async () => {
    const png = renderPngWithText('', 200, 50);
    const [page] = await ocrPngPages([png]);
    expect(page!.words).toHaveLength(0);
  }, 60_000);

  it('reports per-page progress via onPageDone', async () => {
    const pngs = [renderPngWithText('AAA'), renderPngWithText('BBB')];
    const seen: Array<[number, number]> = [];
    await ocrPngPages(pngs, { onPageDone: (i, n) => seen.push([i, n]) });
    expect(seen).toEqual([[0, 2], [1, 2]]);
  }, 90_000);
});
