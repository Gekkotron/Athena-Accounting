import { describe, it, expect } from 'vitest';
import {
  normalizeCategoryKind,
  resolveCategoryRef,
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

describe('resolveCategoryRef', () => {
  // Two 'Restaurant' children under two different parents, plus a top-level
  // 'Restaurant' — the shape that motivated this helper.
  const byPath = new Map<string, number>([
    ['::Loisirs', 1],
    ['::Voyages', 2],
    ['Loisirs::Restaurant', 3],
    ['Voyages::Restaurant', 4],
    ['::Restaurant', 5],
  ]);
  const idsByName = new Map<string, number[]>([
    ['Loisirs', [1]],
    ['Voyages', [2]],
    ['Restaurant', [3, 4, 5]],
  ]);

  it('resolves by (parent, name) path when both are supplied', () => {
    expect(resolveCategoryRef('Restaurant', 'Loisirs', byPath, idsByName)).toBe(3);
    expect(resolveCategoryRef('Restaurant', 'Voyages', byPath, idsByName)).toBe(4);
  });

  it('resolves a root category when parent is explicitly null', () => {
    expect(resolveCategoryRef('Loisirs', null, byPath, idsByName)).toBe(1);
  });

  it('falls back to name lookup when the path misses on a v4-shaped ref', () => {
    expect(resolveCategoryRef('Restaurant', 'Unknown Parent', byPath, idsByName)).toBe(5);
  });

  it('resolves by name only (v3 dump, parent undefined) when the name is unambiguous', () => {
    expect(resolveCategoryRef('Loisirs', undefined, byPath, idsByName)).toBe(1);
  });

  it('prefers the top-level match when a name-only lookup is ambiguous', () => {
    expect(resolveCategoryRef('Restaurant', undefined, byPath, idsByName)).toBe(5);
  });

  it('falls back to the first-inserted candidate when ambiguous with no top-level match', () => {
    const noRootIdsByName = new Map([['Restaurant', [3, 4]]]);
    const noRootByPath = new Map([['Loisirs::Restaurant', 3], ['Voyages::Restaurant', 4]]);
    expect(resolveCategoryRef('Restaurant', undefined, noRootByPath, noRootIdsByName)).toBe(3);
  });

  it('returns null when the name is unresolvable', () => {
    expect(resolveCategoryRef('Missing', undefined, byPath, idsByName)).toBeNull();
  });

  it('returns null when name is null or undefined', () => {
    expect(resolveCategoryRef(null, undefined, byPath, idsByName)).toBeNull();
    expect(resolveCategoryRef(undefined, undefined, byPath, idsByName)).toBeNull();
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
