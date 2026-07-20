// Frozen allow-list of tip ids the client is permitted to persist.
// Mirrored in frontend/src/tips/content.ts; content.test.ts asserts
// literal equality with the mirrored list.
//
// v2: one id per PageId. The prior `welcome_tour` and `section:*` ids
// are removed — orphan keys in existing user_settings.dismissed_tips
// jsonb blobs are swept out at server boot; see cleanup.ts.
export const TIP_IDS = [
  'tour:dashboard',
  'tour:accounts',
  'tour:imports',
  'tour:transactions',
  'tour:rules',
  'tour:budgets',
  'tour:data',
] as const;

export type TipId = typeof TIP_IDS[number];
