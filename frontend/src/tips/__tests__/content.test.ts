import { describe, it, expect } from 'vitest';
import { TIP_IDS, SECTION_TIPS, WELCOME_STEPS } from '../content';

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

  it('SECTION_TIPS has an entry for every section id', () => {
    const sectionIds = TIP_IDS.filter((id) => id !== 'welcome_tour');
    for (const id of sectionIds) {
      expect(SECTION_TIPS[id as Exclude<typeof TIP_IDS[number], 'welcome_tour'>]).toMatchObject({
        title: expect.any(String),
        body: expect.any(String),
      });
    }
  });

  it('WELCOME_STEPS has 3–4 steps', () => {
    expect(WELCOME_STEPS.length).toBeGreaterThanOrEqual(3);
    expect(WELCOME_STEPS.length).toBeLessThanOrEqual(4);
    for (const step of WELCOME_STEPS) {
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.body.length).toBeGreaterThan(0);
    }
  });
});
