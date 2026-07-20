// Central registry for the tip ids the client is allowed to persist via
// TipsContext. Mirrored in backend/src/http/routes/tips/tip-ids.ts —
// __tests__/content.test.ts asserts literal equality across both.
//
// v2: one id per PageId (`tour:<pageId>`). The prior per-feature modal and
// per-section hint ids from v1 are removed by design — see
// docs/superpowers/specs/2026-07-20-tips-anchored-tours-design.md.

import { PAGE_IDS, type PageId } from './tours';

export const TIP_IDS = PAGE_IDS.map((p) => `tour:${p}` as const) as ReadonlyArray<`tour:${PageId}`>;

export type TipId = `tour:${PageId}`;
