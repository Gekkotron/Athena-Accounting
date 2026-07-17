// Central registry for tip ids. The array below must stay in lock-step with
// backend/src/http/routes/tips/tip-ids.ts; a Vitest test in Task 4 asserts
// literal equality. The copy itself (title/body) used to live here as a
// French string table — it now lives in locales/{en,fr}/tips.json, and this
// module only maps each id to its translation-key path, exposed via small
// lookup helpers that take a `t` bound to (or declaring) the 'tips'
// namespace. This mirrors how Task 3 handled Dashboard/insights.ts.

import type { TFunction } from 'i18next';

export const TIP_IDS = [
  'welcome_tour',
  'section:dashboard',
  'section:imports',
  'section:transactions',
  'section:rules',
  'section:budgets',
  'section:accounts',
  'section:data',
] as const;

export type TipId = typeof TIP_IDS[number];
export type SectionTipId = Exclude<TipId, 'welcome_tour'>;

export interface TipCopy { title: string; body: string }

const SECTION_KEY: Record<SectionTipId, string> = {
  'section:dashboard': 'dashboard',
  'section:imports': 'imports',
  'section:transactions': 'transactions',
  'section:rules': 'rules',
  'section:budgets': 'budgets',
  'section:accounts': 'accounts',
  'section:data': 'data',
};

/** Looks up a section tip's translated {title, body}. */
export function sectionTip(id: SectionTipId, t: TFunction): TipCopy {
  const key = SECTION_KEY[id];
  return { title: t(`sections.${key}.title`), body: t(`sections.${key}.body`) };
}

export const WELCOME_STEP_COUNT = 4;

/** Looks up one welcome-tour step's translated {title, body} by 0-based index. */
export function welcomeStep(index: number, t: TFunction): TipCopy {
  return { title: t(`welcome.steps.${index}.title`), body: t(`welcome.steps.${index}.body`) };
}
