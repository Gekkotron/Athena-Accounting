import { describe, it, expect } from 'vitest';
import { BackupBody, VERSION, fileImportKey } from '../src/http/routes/backup/schema.js';

const minimalDump = {
  version: 1 as const,
  accounts: [],
  categories: [],
  accountFilenamePatterns: [],
  rules: [],
  transferRules: [],
  transactions: [],
};

describe('backup/schema.ts', () => {
  it('exports the current schema version constant', () => {
    expect(VERSION).toBe(2);
  });

  it('accepts a minimal, well-formed dump', () => {
    const parsed = BackupBody.safeParse(minimalDump);
    expect(parsed.success).toBe(true);
  });

  it('rejects a dump with the wrong version literal', () => {
    const bad = { ...minimalDump, version: 3 as unknown as 1 };
    const parsed = BackupBody.safeParse(bad);
    expect(parsed.success).toBe(false);
  });

  it('accepts version 2 (splits-capable dumps)', () => {
    const parsed = BackupBody.safeParse({ ...minimalDump, version: 2 as const });
    expect(parsed.success).toBe(true);
  });

  it('rejects a dump missing required top-level keys', () => {
    const bad = { version: 1 as const, accounts: [] }; // missing categories, rules, …
    const parsed = BackupBody.safeParse(bad);
    expect(parsed.success).toBe(false);
  });

  it('accepts optional fileImports / lockYears / notDuplicate fields when present', () => {
    const parsed = BackupBody.safeParse({
      ...minimalDump,
      accounts: [
        {
          name: 'PEA', type: 'brokerage', currency: 'EUR',
          openingBalance: '0.00', openingDate: '2024-01-01',
          lockYears: 5, displayOrder: 1,
        },
      ],
      transactions: [
        {
          account: 'PEA', date: '2024-06-01', amount: '500.00',
          rawLabel: 'Versement', normalizedLabel: 'versement',
          dedupKey: 'k1', categorySource: 'manual',
          lockYears: 5, notDuplicate: true,
          sourceFileKey: 'file.pdf|2024-06-01T00:00:00.000Z',
        },
      ],
      fileImports: [
        {
          account: 'PEA', filename: 'file.pdf', format: 'pdf',
          importedAt: '2024-06-01T00:00:00.000Z',
          totalLines: 3, insertedCount: 3, dedupSkipped: 0,
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown categorySource value', () => {
    const bad = {
      ...minimalDump,
      transactions: [
        {
          account: 'X', date: '2024-01-01', amount: '1.00',
          rawLabel: 'r', normalizedLabel: 'r', dedupKey: 'k',
          categorySource: 'chatgpt', // not in the enum
        },
      ],
    };
    const parsed = BackupBody.safeParse(bad);
    expect(parsed.success).toBe(false);
  });

  it('rejects a lockYears value outside [0, 99]', () => {
    for (const bad of [-1, 100, 999]) {
      const parsed = BackupBody.safeParse({
        ...minimalDump,
        accounts: [
          {
            name: 'x', type: 'checking', currency: 'EUR',
            openingBalance: '0', openingDate: '2024-01-01',
            lockYears: bad,
          },
        ],
      });
      expect(parsed.success, `lockYears=${bad}`).toBe(false);
    }
  });

  it('accepts a dump that omits the legacy transferRules field entirely', () => {
    const { transferRules: _tr, ...withoutTransferRules } = minimalDump;
    void _tr;
    const parsed = BackupBody.safeParse(withoutTransferRules);
    expect(parsed.success).toBe(true);
  });

  it('accepts a dump that carries balanceCheckpoints', () => {
    const parsed = BackupBody.safeParse({
      ...minimalDump,
      balanceCheckpoints: [
        {
          account: 'Compte courant',
          checkpointDate: '2026-06-01',
          expectedAmount: '1234.56',
          note: 'relevé mai',
        },
        {
          account: 'Livret A',
          checkpointDate: '2026-01-01',
          expectedAmount: '5000.00',
          note: null,
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a checkpointDate that is not YYYY-MM-DD', () => {
    const parsed = BackupBody.safeParse({
      ...minimalDump,
      balanceCheckpoints: [
        { account: 'X', checkpointDate: '01-06-2026', expectedAmount: '1.00' },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it('coerces legacy categoryKind=transfer via schema.z.enum acceptance', () => {
    // The schema tolerates kind='transfer' from old exports so restore.ts can
    // remap it to 'neutral'. This test just guards that the value still
    // validates — the remap itself lives in restore.ts.
    const parsed = BackupBody.safeParse({
      ...minimalDump,
      categories: [
        { name: 'Internal', kind: 'transfer', isDefault: false },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a budget with monthlyLimit of "0"', () => {
    const parsed = BackupBody.safeParse({
      ...minimalDump,
      budgets: [
        { category: 'Groceries', monthlyLimit: '0', currency: 'EUR' },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts a budget with a positive monthlyLimit', () => {
    const parsed = BackupBody.safeParse({
      ...minimalDump,
      budgets: [
        { category: 'Groceries', monthlyLimit: '300.00', currency: 'EUR' },
      ],
    });
    expect(parsed.success).toBe(true);
  });
});

describe('fileImportKey', () => {
  it('joins filename and ISO timestamp with a pipe separator', () => {
    expect(fileImportKey('bnp.pdf', '2024-06-01T00:00:00.000Z'))
      .toBe('bnp.pdf|2024-06-01T00:00:00.000Z');
  });

  it('is a deterministic natural key (same inputs → same output)', () => {
    const a = fileImportKey('x.csv', '2025-01-01T12:00:00.000Z');
    const b = fileImportKey('x.csv', '2025-01-01T12:00:00.000Z');
    expect(a).toBe(b);
  });

  it('distinguishes two imports of the same filename at different times', () => {
    const a = fileImportKey('same.pdf', '2025-01-01T00:00:00.000Z');
    const b = fileImportKey('same.pdf', '2025-02-01T00:00:00.000Z');
    expect(a).not.toBe(b);
  });
});
