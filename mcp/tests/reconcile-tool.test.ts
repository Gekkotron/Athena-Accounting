import { describe, it, expect, vi } from 'vitest';
import { readPdfBase64, summarizeSearch } from '../src/tools.js';

vi.mock('node:fs', () => {
  const files: Record<string, Buffer> = { '/tmp/ok.pdf': Buffer.from('%PDF-1.4 fake') };
  return {
    statSync: (p: string) => { if (!files[p]) { const e: any = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return { size: files[p].length, isFile: () => true }; },
    readFileSync: (p: string) => files[p],
  };
});

describe('reconcile tool helpers', () => {
  it('readPdfBase64 reads + base64-encodes an existing .pdf', () => {
    expect(readPdfBase64('/tmp/ok.pdf')).toBe(Buffer.from('%PDF-1.4 fake').toString('base64'));
  });
  it('rejects a non-.pdf path', () => {
    expect(() => readPdfBase64('/tmp/ok.txt')).toThrow(/\.pdf/);
  });
  it('rejects a missing file', () => {
    expect(() => readPdfBase64('/tmp/missing.pdf')).toThrow(/not found|ENOENT/i);
  });
  it('summarizeSearch produces a one-line count/range/total', () => {
    const result = { transactions: [
      { date: '2025-04-01', amount: '-10.00' }, { date: '2025-04-30', amount: '-2.40' },
    ], pagination: { total: 2 } };
    const line = summarizeSearch(result);
    expect(line).toContain('2 transaction');
    expect(line).toContain('2025-04-01');
    expect(line).toContain('2025-04-30');
  });
});
