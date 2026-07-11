import { describe, it, expect } from 'vitest';
import { formatCategoryPath } from '../categories';
import type { Category } from '../../api/types';

function cat(id: number, name: string, parentId: number | null = null): Category {
  return { id, name, kind: 'expense', color: null, parentId, isDefault: false, isInternalTransfer: false };
}

describe('formatCategoryPath', () => {
  const parent = cat(1, 'Courses');
  const child = cat(2, 'Alimentation', 1);
  const byId = new Map<number, Category>([[1, parent], [2, child]]);

  it('returns the plain name for a top-level category', () => {
    expect(formatCategoryPath(parent, byId)).toBe('Courses');
  });

  it("joins parent name and leaf name with '›'", () => {
    expect(formatCategoryPath(child, byId)).toBe('Courses › Alimentation');
  });

  it('falls back to the plain name when the parent is missing from the map', () => {
    const orphanMap = new Map<number, Category>([[2, child]]);
    expect(formatCategoryPath(child, orphanMap)).toBe('Alimentation');
  });
});
