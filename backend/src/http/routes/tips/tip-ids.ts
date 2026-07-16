// Frozen allow-list of tip ids the client is permitted to dismiss.
// Mirrored in frontend/src/tips/content.ts; a Vitest test in Task 4
// reads that file and asserts literal equality with this array.
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
