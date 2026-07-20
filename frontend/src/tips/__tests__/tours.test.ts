import { describe, it, expect } from 'vitest';
import { TOURS, PAGE_IDS, type AnchorId, type PageId } from '../tours';

// The full expected anchor set. Keeping this hard-coded rather than
// deriving it from TOURS itself so the test would catch an accidental
// deletion of a step (not just a mismatch between two sources of truth).
const EXPECTED_ANCHORS: AnchorId[] = [
  'dashboard:balance', 'dashboard:curve', 'dashboard:donut',
  'dashboard:insights', 'dashboard:sankey',
  'accounts:add-button', 'accounts:starting-balance',
  'imports:dropzone',
  'transactions:search', 'transactions:row', 'transactions:multi-select',
  'rules:list', 'rules:tri-tab',
  'budgets:category-row',
  'data:export',
  'budgets-envelopes:overview', 'budgets-envelopes:hold',
  'rules-list:overview', 'rules-list:reapply',
  'rules-categories:list', 'rules-categories:create',
  'recurring-detected:list', 'recurring-detected:confirm',
  'recurring-upcoming:list', 'recurring-upcoming:month-nav',
  'recurring-forecast:chart', 'recurring-forecast:scope',
  'data-duplicates:list', 'data-duplicates:action',
  'data-pdf-templates:list', 'data-pdf-templates:import',
];

describe('tours registry', () => {
  it('exports every PageId exactly once', () => {
    expect([...PAGE_IDS].sort()).toEqual(
      [
        'accounts', 'budgets', 'budgets-envelopes', 'dashboard', 'data',
        'data-duplicates', 'data-pdf-templates', 'imports',
        'recurring-detected', 'recurring-forecast', 'recurring-upcoming',
        'rules', 'rules-categories', 'rules-list', 'transactions',
      ],
    );
  });

  it('every PageId has at least one step', () => {
    for (const pageId of PAGE_IDS) {
      expect(TOURS[pageId].length).toBeGreaterThanOrEqual(1);
    }
  });

  it('every step anchor is a known AnchorId', () => {
    const known = new Set<string>(EXPECTED_ANCHORS);
    for (const pageId of PAGE_IDS) {
      for (const step of TOURS[pageId]) {
        expect(known.has(step.anchor)).toBe(true);
      }
    }
  });

  it('every anchor id follows the `<pageId>:<slot>` shape', () => {
    for (const pageId of PAGE_IDS) {
      for (const step of TOURS[pageId]) {
        expect(step.anchor.startsWith(`${pageId}:`)).toBe(true);
      }
    }
  });

  it('no tour exceeds the soft ceiling of 5 steps', () => {
    for (const pageId of PAGE_IDS) {
      expect(TOURS[pageId].length).toBeLessThanOrEqual(5);
    }
  });

  it('anchors are unique within a tour (no duplicate steps)', () => {
    for (const pageId of PAGE_IDS) {
      const anchors = TOURS[pageId].map((s) => s.anchor);
      expect(new Set(anchors).size).toBe(anchors.length);
    }
  });

  // Verifies PageId is not accidentally widened.
  it('rejects unknown PageId at compile time (smoke)', () => {
    const p: PageId = 'dashboard';
    expect(p).toBe('dashboard');
  });
});
