import { describe, it, expect } from 'vitest';
import { buildExportUrl, readIntParam, truncate, sortCategoriesForPicker, toggleAllInSet, toggleInSet } from '../lib';
import type { Category } from '../../../api/types';
import type { Filters } from '../filters';

describe('buildExportUrl', () => {
  const base: Filters = { sort: 'date', order: 'desc' };

  it('carries every set filter and drops unset ones', () => {
    const url = buildExportUrl({
      ...base,
      accountId: 3,
      categoryId: 7,
      fromDate: '2026-01-01',
      toDate: '2026-06-30',
    });
    expect(url.startsWith('/api/transactions/export?')).toBe(true);
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('accountId')).toBe('3');
    expect(params.get('categoryId')).toBe('7');
    expect(params.get('fromDate')).toBe('2026-01-01');
    expect(params.get('toDate')).toBe('2026-06-30');
    expect(params.get('sort')).toBe('date');
    expect(params.get('order')).toBe('desc');
    expect(params.has('search')).toBe(false);
    expect(params.has('amount')).toBe(false);
    expect(params.has('sourceFileId')).toBe(false);
  });

  it('URL-encodes free-text search values', () => {
    const url = buildExportUrl({ ...base, search: 'café & thé' });
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('search')).toBe('café & thé');
  });

  it('drops empty-string values', () => {
    const url = buildExportUrl({ ...base, search: '' });
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.has('search')).toBe(false);
  });
});

const cat = (id: number, name: string, parentId: number | null = null): Category =>
  ({ id, name, parentId } as Category);

describe('readIntParam', () => {
  const sp = (kv: Record<string, string>) => new URLSearchParams(kv);

  it('returns a positive integer', () => {
    expect(readIntParam(sp({ id: '42' }), 'id')).toBe(42);
  });

  it('returns undefined for missing, empty, non-numeric, zero, negative, or non-integer', () => {
    expect(readIntParam(sp({}), 'id')).toBeUndefined();
    expect(readIntParam(sp({ id: '' }), 'id')).toBeUndefined();
    expect(readIntParam(sp({ id: 'abc' }), 'id')).toBeUndefined();
    expect(readIntParam(sp({ id: '0' }), 'id')).toBeUndefined();
    expect(readIntParam(sp({ id: '-5' }), 'id')).toBeUndefined();
    expect(readIntParam(sp({ id: '1.5' }), 'id')).toBeUndefined();
  });
});

describe('truncate', () => {
  it('returns the string unchanged when short enough', () => {
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('exact', 5)).toBe('exact');
  });

  it('cuts to n-1 chars and appends an ellipsis when longer than n', () => {
    expect(truncate('exceeds limit', 8)).toBe('exceeds…');
  });
});

describe('sortCategoriesForPicker', () => {
  it('groups children under their parent name, then orders alphabetically by name within a group', () => {
    const cats = [
      cat(10, 'Zoo'),
      cat(1, 'Alimentation'),
      cat(2, 'Restaurant', 1),
      cat(3, 'Café', 1),
      cat(20, 'Yield'),
    ];
    const catById = new Map(cats.map((c) => [c.id, c] as const));
    const sorted = sortCategoriesForPicker(cats, catById).map((c) => c.name);
    // Parent-name grouping keys: Alimentation, Alimentation, Alimentation, Yield, Zoo
    // Within Alimentation group, alphabetical by child name.
    expect(sorted).toEqual(['Alimentation', 'Café', 'Restaurant', 'Yield', 'Zoo']);
  });

  it('does not mutate the input array', () => {
    const cats = [cat(2, 'B'), cat(1, 'A')];
    const before = cats.map((c) => c.name);
    sortCategoriesForPicker(cats, new Map(cats.map((c) => [c.id, c] as const)));
    expect(cats.map((c) => c.name)).toEqual(before);
  });

  it('falls back to child name when a subcategory references an unknown parent', () => {
    const cats = [cat(1, 'B', 999), cat(2, 'A', 999)];
    const catById = new Map(cats.map((c) => [c.id, c] as const));
    // Both look up parentId=999 → undefined → empty string, so tie-break by child name.
    expect(sortCategoriesForPicker(cats, catById).map((c) => c.name)).toEqual(['A', 'B']);
  });
});

describe('toggleInSet', () => {
  it('adds an item when on=true and it was absent', () => {
    const s = new Set([1, 2]);
    const next = toggleInSet(s, 3, true);
    expect([...next].sort()).toEqual([1, 2, 3]);
    expect(next).not.toBe(s);
  });

  it('removes an item when on=false and it was present', () => {
    const next = toggleInSet(new Set([1, 2, 3]), 2, false);
    expect([...next].sort()).toEqual([1, 3]);
  });

  it('is a no-op on the resulting membership when the operation is redundant', () => {
    expect([...toggleInSet(new Set([1]), 1, true)]).toEqual([1]);
    expect([...toggleInSet(new Set([1]), 2, false)]).toEqual([1]);
  });

  it('returns a fresh Set (no aliasing)', () => {
    const src = new Set([1]);
    const next = toggleInSet(src, 2, true);
    src.add(99);
    expect(next.has(99)).toBe(false);
  });
});

describe('toggleAllInSet', () => {
  it('adds every id when on=true, preserving existing members', () => {
    const next = toggleAllInSet(new Set([1]), [2, 3], true);
    expect([...next].sort()).toEqual([1, 2, 3]);
  });

  it('removes every id when on=false and leaves others untouched', () => {
    const next = toggleAllInSet(new Set([1, 2, 3]), [1, 3], false);
    expect([...next]).toEqual([2]);
  });

  it('returns the original set unchanged when ids is empty', () => {
    const src = new Set([1]);
    expect(toggleAllInSet(src, [], true)).toBe(src);
  });
});
