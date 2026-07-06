import { describe, it, expect } from 'vitest';
import {
  normalizeCategoryKind,
  planCategoryParentLinks,
  resolveNameToId,
} from '../src/http/routes/backup/helpers.js';
import { fileImportKey } from '../src/http/routes/backup/schema.js';

describe('resolveNameToId', () => {
  const map = new Map<string, number>([
    ['Compte Courant', 1],
    ['Épargne', 2],
  ]);

  it('returns the id when the name is known', () => {
    expect(resolveNameToId('Compte Courant', map)).toBe(1);
    expect(resolveNameToId('Épargne', map)).toBe(2);
  });

  it('returns null when the name is unknown', () => {
    expect(resolveNameToId('Missing', map)).toBeNull();
  });

  it('returns null when the name is null / undefined', () => {
    expect(resolveNameToId(null, map)).toBeNull();
    expect(resolveNameToId(undefined, map)).toBeNull();
  });

  it('treats the empty string as a missing key (map has no entry)', () => {
    expect(resolveNameToId('', map)).toBeNull();
  });
});

describe('normalizeCategoryKind', () => {
  it('passes expense / income / neutral through untouched', () => {
    expect(normalizeCategoryKind('expense')).toBe('expense');
    expect(normalizeCategoryKind('income')).toBe('income');
    expect(normalizeCategoryKind('neutral')).toBe('neutral');
  });

  it('coerces legacy transfer to neutral', () => {
    expect(normalizeCategoryKind('transfer')).toBe('neutral');
  });
});

describe('planCategoryParentLinks', () => {
  const commonDump = [
    { name: 'Root',   kind: 'neutral' as const, isDefault: false },
    { name: 'Child',  kind: 'expense' as const, isDefault: false, parent: 'Root' },
    { name: 'GChild', kind: 'expense' as const, isDefault: false, parent: 'Child' },
  ];

  it('returns an empty batch when no category has a parent', () => {
    const dump = [
      { name: 'A', kind: 'expense' as const, isDefault: false },
      { name: 'B', kind: 'income'  as const, isDefault: false, parent: null },
    ];
    const idByName = new Map([['A', 10], ['B', 20]]);
    expect(planCategoryParentLinks(dump, idByName)).toEqual([]);
  });

  it('wires each parent when both child and parent are in the id map', () => {
    const idByName = new Map([['Root', 1], ['Child', 2], ['GChild', 3]]);
    expect(planCategoryParentLinks(commonDump, idByName)).toEqual([
      { childId: 2, parentId: 1 },
      { childId: 3, parentId: 2 },
    ]);
  });

  it('skips a category whose parent is not in the id map', () => {
    const idByName = new Map([['Child', 2]]);   // Root missing
    expect(planCategoryParentLinks(commonDump, idByName)).toEqual([]);
  });

  it('skips a category that is not itself in the id map', () => {
    // Root and GChild present, Child missing — GChild's parent (Child) is
    // absent, so no link for it either.
    const idByName = new Map([['Root', 1], ['GChild', 3]]);
    expect(planCategoryParentLinks(commonDump, idByName)).toEqual([]);
  });

  it('preserves dump order in the emitted batch', () => {
    const orderedDump = [
      { name: 'C1', kind: 'expense' as const, isDefault: false, parent: 'Root' },
      { name: 'Root', kind: 'neutral' as const, isDefault: false },
      { name: 'C2', kind: 'expense' as const, isDefault: false, parent: 'Root' },
    ];
    const idByName = new Map([['Root', 100], ['C1', 101], ['C2', 102]]);
    expect(planCategoryParentLinks(orderedDump, idByName)).toEqual([
      { childId: 101, parentId: 100 },
      { childId: 102, parentId: 100 },
    ]);
  });
});

describe('fileImportKey', () => {
  it('joins filename and importedAt ISO string with a pipe', () => {
    expect(fileImportKey('statement.pdf', '2026-07-06T09:00:00.000Z'))
      .toBe('statement.pdf|2026-07-06T09:00:00.000Z');
  });

  it('preserves characters that can appear in filenames (spaces, accents)', () => {
    expect(fileImportKey('Relevé Juillet 2026.pdf', '2026-07-01T00:00:00.000Z'))
      .toBe('Relevé Juillet 2026.pdf|2026-07-01T00:00:00.000Z');
  });

  it('yields a distinct key when only the timestamp differs', () => {
    const a = fileImportKey('same.pdf', '2026-07-06T09:00:00.000Z');
    const b = fileImportKey('same.pdf', '2026-07-06T10:00:00.000Z');
    expect(a).not.toBe(b);
  });

  it('yields a distinct key when only the filename differs', () => {
    const a = fileImportKey('a.pdf', '2026-07-06T09:00:00.000Z');
    const b = fileImportKey('b.pdf', '2026-07-06T09:00:00.000Z');
    expect(a).not.toBe(b);
  });
});
