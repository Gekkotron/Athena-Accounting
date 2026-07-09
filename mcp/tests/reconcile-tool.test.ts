import { describe, it, expect, vi } from 'vitest';
import { readPdfBase64, summarizeSearch } from '../src/tools.js';

const okBytes = Buffer.from('%PDF-1.4 fake');

vi.mock('node:os', () => ({ homedir: () => '/home/julien' }));

vi.mock('node:fs', () => {
  // Self-contained: vi.mock is hoisted, so the factory cannot close over
  // top-level vars (okBytes). Rebuild the same bytes here.
  const bytes = Buffer.from('%PDF-1.4 fake');
  const files: Record<string, Buffer> = {
    '/tmp/ok.pdf': bytes,
    '/statements/april.pdf': bytes,
    '/home/julien/docs/ok.pdf': bytes,
  };
  // Directories (statSync → isFile:false); '/archive.pdf' is a dir whose name ends in .pdf.
  const dirs: Record<string, string[]> = {
    '/statements': ['april.pdf', 'may.pdf', 'notes.txt'],
    '/archive.pdf': [],
  };
  return {
    statSync: (p: string) => {
      if (p in dirs) return { size: 0, isFile: () => false };
      if (!files[p]) { const e: any = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      return { size: files[p].length, isFile: () => true };
    },
    readFileSync: (p: string) => files[p],
    readdirSync: (p: string) => { if (!(p in dirs)) { const e: any = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return dirs[p]; },
  };
});

describe('reconcile tool helpers', () => {
  it('readPdfBase64 reads + base64-encodes an existing absolute .pdf', () => {
    expect(readPdfBase64('/tmp/ok.pdf')).toBe(okBytes.toString('base64'));
  });

  it('resolves a bare filename against the statements dir', () => {
    expect(readPdfBase64('april.pdf', '/statements')).toBe(okBytes.toString('base64'));
  });

  it('expands a leading ~ to the home directory', () => {
    expect(readPdfBase64('~/docs/ok.pdf')).toBe(okBytes.toString('base64'));
  });

  it('rejects a non-.pdf path', () => {
    expect(() => readPdfBase64('/tmp/ok.txt')).toThrow(/\.pdf/);
  });

  it('rejects a directory whose name ends in .pdf', () => {
    expect(() => readPdfBase64('/archive.pdf')).toThrow(/not a file/i);
  });

  it('rejects a missing file and lists the available PDFs in the statements dir', () => {
    let msg = '';
    try { readPdfBase64('missing.pdf', '/statements'); }
    catch (err) { msg = (err as Error).message; }
    expect(msg).toMatch(/not found/i);
    expect(msg).toContain('april.pdf');
    expect(msg).toContain('may.pdf');
    expect(msg).not.toContain('notes.txt'); // only .pdf files listed
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
