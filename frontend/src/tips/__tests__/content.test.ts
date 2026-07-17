import { describe, it, expect, beforeAll } from 'vitest';
import { TIP_IDS, sectionTip, welcomeStep, WELCOME_STEP_COUNT, type SectionTipId } from '../content';
import i18n from '../../i18n';

beforeAll(async () => {
  await i18n.changeLanguage('fr');
  await i18n.loadNamespaces(['tips']);
});

describe('tips content registry', () => {
  it('TIP_IDS has all 8 ids in the frozen order', () => {
    expect([...TIP_IDS]).toEqual([
      'welcome_tour',
      'section:dashboard',
      'section:imports',
      'section:transactions',
      'section:rules',
      'section:budgets',
      'section:accounts',
      'section:data',
    ]);
  });

  it('sectionTip() resolves a non-empty {title, body} for every section id', () => {
    const t = i18n.getFixedT('fr', 'tips');
    const sectionIds = TIP_IDS.filter((id) => id !== 'welcome_tour') as SectionTipId[];
    for (const id of sectionIds) {
      const copy = sectionTip(id, t);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.body.length).toBeGreaterThan(0);
      // Lookups must actually resolve — a missing key falls back to the key
      // string itself (containing a '.'), which would never happen for
      // real prose copy.
      expect(copy.title).not.toContain('.');
    }
  });

  it('WELCOME_STEP_COUNT is 3–4 and welcomeStep() resolves every index', () => {
    expect(WELCOME_STEP_COUNT).toBeGreaterThanOrEqual(3);
    expect(WELCOME_STEP_COUNT).toBeLessThanOrEqual(4);
    const t = i18n.getFixedT('fr', 'tips');
    for (let i = 0; i < WELCOME_STEP_COUNT; i++) {
      const step = welcomeStep(i, t);
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.body.length).toBeGreaterThan(0);
    }
  });
});
