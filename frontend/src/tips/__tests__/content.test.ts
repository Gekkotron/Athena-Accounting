import { describe, it, expect } from 'vitest';
import { TIP_IDS } from '../content';
import i18n from '../../i18n';
import { pinLocale } from '../../test/i18n';
import { PAGE_IDS, TOURS } from '../tours';

pinLocale('tips');

describe('tips content registry (v2)', () => {
  it('TIP_IDS has one `tour:<pageId>` per PageId, in PAGE_IDS order', () => {
    expect([...TIP_IDS]).toEqual([
      'tour:dashboard',
      'tour:accounts',
      'tour:imports',
      'tour:transactions',
      'tour:rules',
      'tour:budgets',
      'tour:data',
      'tour:budgets-envelopes',
      'tour:rules-list',
      'tour:rules-categories',
      'tour:recurring-detected',
      'tour:recurring-upcoming',
      'tour:recurring-forecast',
      'tour:data-duplicates',
      'tour:data-pdf-templates',
    ]);
    expect(TIP_IDS.length).toBe(PAGE_IDS.length);
  });

  it('every tour step resolves a non-empty {title, body} in French', () => {
    const t = i18n.getFixedT('fr', 'tips');
    for (const pageId of PAGE_IDS) {
      TOURS[pageId].forEach((_step, idx) => {
        const title = t(`tours.${pageId}.${idx}.title`);
        const body = t(`tours.${pageId}.${idx}.body`);
        expect(typeof title).toBe('string');
        expect(title.length).toBeGreaterThan(0);
        expect(title).not.toContain('tours.'); // missing-key fallback would contain the key path
        expect(typeof body).toBe('string');
        expect(body.length).toBeGreaterThan(0);
        expect(body).not.toContain('tours.');
      });
    }
  });

  it('every tour step resolves a non-empty {title, body} in English', () => {
    const t = i18n.getFixedT('en', 'tips');
    for (const pageId of PAGE_IDS) {
      TOURS[pageId].forEach((_step, idx) => {
        const title = t(`tours.${pageId}.${idx}.title`);
        const body = t(`tours.${pageId}.${idx}.body`);
        expect(title.length).toBeGreaterThan(0);
        expect(title).not.toContain('tours.');
        expect(body.length).toBeGreaterThan(0);
        expect(body).not.toContain('tours.');
      });
    }
  });
});
