import { describe, it, expect } from 'vitest';
import { resolveDrop } from '../dragNest';
import type { Category } from '../../../api/types';

const c = (id: number, parentId: number | null = null): Category => ({
  id,
  name: `cat-${id}`,
  kind: 'expense',
  color: null,
  parentId,
  isDefault: false,
  isInternalTransfer: false,
});

describe('resolveDrop', () => {
  it('nests a childless root under another root', () => {
    const cats = [c(1), c(2)];
    expect(resolveDrop(1, { kind: 'root', targetId: 2 }, cats)).toEqual({
      id: 1,
      parentId: 2,
    });
  });

  it('re-parents an existing child onto a different root', () => {
    const cats = [c(1), c(2), c(3, 1)];
    expect(resolveDrop(3, { kind: 'root', targetId: 2 }, cats)).toEqual({
      id: 3,
      parentId: 2,
    });
  });

  it('promotes a child back to root', () => {
    const cats = [c(1), c(2, 1)];
    expect(resolveDrop(2, { kind: 'promote' }, cats)).toEqual({
      id: 2,
      parentId: null,
    });
  });

  it('returns null when a root is dropped on the promote band (already root)', () => {
    const cats = [c(1)];
    expect(resolveDrop(1, { kind: 'promote' }, cats)).toBeNull();
  });

  it('returns null when dropped on self', () => {
    const cats = [c(1)];
    expect(resolveDrop(1, { kind: 'root', targetId: 1 }, cats)).toBeNull();
  });

  it('returns null when dropped on the current parent (no-op)', () => {
    const cats = [c(1), c(2, 1)];
    expect(resolveDrop(2, { kind: 'root', targetId: 1 }, cats)).toBeNull();
  });

  it('returns null when target is not a root (2-level rule)', () => {
    const cats = [c(1), c(2, 1), c(3)];
    // 3 is a root, we drag it onto 2 which is a child — invalid.
    expect(resolveDrop(3, { kind: 'root', targetId: 2 }, cats)).toBeNull();
  });

  it('returns null when the dragged row already has children', () => {
    const cats = [c(1), c(2), c(3, 1)];
    // 1 is a root with child 3; cannot be nested under 2.
    expect(resolveDrop(1, { kind: 'root', targetId: 2 }, cats)).toBeNull();
  });

  it('returns null when target is missing', () => {
    expect(resolveDrop(1, null, [c(1)])).toBeNull();
  });

  it('returns null when active is not in the list', () => {
    expect(resolveDrop(99, { kind: 'root', targetId: 1 }, [c(1)])).toBeNull();
  });
});
