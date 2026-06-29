import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  importFormatEnum,
  pdfStatementTemplates,
  pdfImportDrafts,
} from '../../src/db/schema.js';
import { validateZones, type TemplateZones } from '../../src/domain/imports/pdf/zones.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationSql = readFileSync(
  resolve(here, '../../src/db/migrations/0003_pdf_import.sql'),
  'utf8',
);

describe('0003_pdf_import migration', () => {
  it('adds "pdf" to import_format enum', () => {
    expect(migrationSql).toMatch(/ALTER TYPE import_format ADD VALUE IF NOT EXISTS 'pdf'/);
    expect(importFormatEnum.enumValues).toEqual(
      expect.arrayContaining(['ofx', 'csv', 'pdf']),
    );
  });

  it('creates pdf_statement_templates with UNIQUE fingerprint', () => {
    expect(migrationSql).toMatch(/CREATE TABLE pdf_statement_templates/);
    expect(migrationSql).toMatch(/fingerprint\s+TEXT NOT NULL UNIQUE/);
    expect(migrationSql).toMatch(/source\s+TEXT NOT NULL CHECK \(source IN \('heuristic', 'interactive'\)\)/);
    const cols = Object.keys(pdfStatementTemplates).filter((k) => !k.startsWith('_'));
    expect(cols).toEqual(
      expect.arrayContaining(['id', 'fingerprint', 'label', 'zones', 'source', 'createdAt', 'updatedAt']),
    );
  });

  it('creates pdf_import_drafts with FK to accounts and expires_at index', () => {
    expect(migrationSql).toMatch(/CREATE TABLE pdf_import_drafts/);
    expect(migrationSql).toMatch(/account_id\s+INTEGER NOT NULL REFERENCES accounts\(id\) ON DELETE CASCADE/);
    expect(migrationSql).toMatch(/pdf_bytes\s+BYTEA NOT NULL/);
    expect(migrationSql).toMatch(/CREATE INDEX pdf_import_drafts_expires_at_idx ON pdf_import_drafts\(expires_at\)/);
    const cols = Object.keys(pdfImportDrafts).filter((k) => !k.startsWith('_'));
    expect(cols).toEqual(
      expect.arrayContaining(['id', 'accountId', 'pdfBytes', 'textItems', 'fingerprint', 'createdAt', 'expiresAt']),
    );
  });
});

describe('validateZones', () => {
  const baseZones: TemplateZones = {
    headerZone: { page: 0, x: 0, y: 0, w: 595, h: 100 },
    tableZone: { page: 0, x: 30, y: 200, w: 540, h: 600 },
    tableRepeatsPerPage: false,
    rowsStartY: 210,
    columns: [
      { xStart: 30, xEnd: 110, role: 'date' },
      { xStart: 110, xEnd: 470, role: 'description' },
      { xStart: 470, xEnd: 570, role: 'amountSigned' },
    ],
  };

  it('accepts a signed-amount layout', () => {
    expect(() => validateZones(baseZones)).not.toThrow();
  });

  it('accepts a debit/credit layout', () => {
    expect(() =>
      validateZones({
        ...baseZones,
        columns: [
          { xStart: 30, xEnd: 110, role: 'date' },
          { xStart: 110, xEnd: 380, role: 'description' },
          { xStart: 380, xEnd: 470, role: 'debit' },
          { xStart: 470, xEnd: 570, role: 'credit' },
        ],
      }),
    ).not.toThrow();
  });

  it('rejects zero date columns', () => {
    expect(() =>
      validateZones({
        ...baseZones,
        columns: baseZones.columns.map((c) => (c.role === 'date' ? { ...c, role: 'ignore' as const } : c)),
      }),
    ).toThrow(/date/);
  });

  it('rejects zero description columns', () => {
    expect(() =>
      validateZones({
        ...baseZones,
        columns: baseZones.columns.map((c) => (c.role === 'description' ? { ...c, role: 'ignore' as const } : c)),
      }),
    ).toThrow(/description/);
  });

  it('rejects mixed signed + debit/credit', () => {
    expect(() =>
      validateZones({
        ...baseZones,
        columns: [
          { xStart: 30, xEnd: 110, role: 'date' },
          { xStart: 110, xEnd: 380, role: 'description' },
          { xStart: 380, xEnd: 470, role: 'amountSigned' },
          { xStart: 470, xEnd: 570, role: 'credit' },
        ],
      }),
    ).toThrow(/amountSigned/);
  });
});
