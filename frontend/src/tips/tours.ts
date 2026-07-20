// Structural registry for the anchored per-page guided tours. Copy lives
// in locales/{en,fr}/tips.json under the `tours` root; this file
// deliberately holds no user-facing strings — copy is looked up by index
// via t(`tours.${pageId}.${stepIdx}.title` | `.body`).

export type PageId =
  | 'dashboard'
  | 'accounts'
  | 'imports'
  | 'transactions'
  | 'rules'
  | 'budgets'
  | 'data'
  | 'budgets-envelopes'
  | 'rules-list'
  | 'rules-categories'
  | 'recurring-detected'
  | 'recurring-upcoming'
  | 'recurring-forecast'
  | 'data-duplicates'
  | 'data-pdf-templates';

export const PAGE_IDS: readonly PageId[] = [
  'dashboard',
  'accounts',
  'imports',
  'transactions',
  'rules',
  'budgets',
  'data',
  'budgets-envelopes',
  'rules-list',
  'rules-categories',
  'recurring-detected',
  'recurring-upcoming',
  'recurring-forecast',
  'data-duplicates',
  'data-pdf-templates',
] as const;

export type AnchorId =
  | 'dashboard:balance' | 'dashboard:curve' | 'dashboard:donut'
  | 'dashboard:insights' | 'dashboard:sankey'
  | 'accounts:add-button' | 'accounts:starting-balance'
  | 'imports:dropzone'
  | 'transactions:search' | 'transactions:row' | 'transactions:multi-select'
  | 'rules:list' | 'rules:tri-tab'
  | 'budgets:category-row'
  | 'data:export'
  | 'budgets-envelopes:overview' | 'budgets-envelopes:hold'
  | 'rules-list:overview' | 'rules-list:reapply'
  | 'rules-categories:list' | 'rules-categories:create'
  | 'recurring-detected:list' | 'recurring-detected:confirm'
  | 'recurring-upcoming:list' | 'recurring-upcoming:month-nav'
  | 'recurring-forecast:chart' | 'recurring-forecast:scope'
  | 'data-duplicates:list' | 'data-duplicates:action'
  | 'data-pdf-templates:list' | 'data-pdf-templates:import';

export type Placement =
  | 'top' | 'bottom' | 'left' | 'right'
  | 'top-start' | 'top-end'
  | 'bottom-start' | 'bottom-end'
  | 'left-start' | 'right-start';

export interface TourStep {
  anchor: AnchorId;
  placement?: Placement; // defaults to 'bottom-start' in TourBubble
}

// Persistence id derived from the PageId. Kept as a helper (not a type
// alias) so the AnchorId → tour:pageId inference is done at one place.
export function tipIdFor(pageId: PageId): `tour:${PageId}` {
  return `tour:${pageId}` as const;
}

export const TOURS: Record<PageId, TourStep[]> = {
  dashboard: [
    // Dashboard anchors are zero-size markers pinned at each section's
    // top-right (right-4, top-4); `bottom-end` hangs the bubble below-right,
    // aligned with the section's right edge. The arrow points up at the
    // marker so it visually reads as "this whole section". Combined with
    // TourBubble's shift/size middleware, the bubble always stays fully
    // in-viewport even on narrow displays.
    { anchor: 'dashboard:balance',  placement: 'bottom-end' },
    { anchor: 'dashboard:insights', placement: 'bottom-end' },
    { anchor: 'dashboard:curve',    placement: 'bottom-end' },
    { anchor: 'dashboard:donut',    placement: 'bottom-end' },
    { anchor: 'dashboard:sankey',   placement: 'bottom-end' },
  ],
  accounts: [
    { anchor: 'accounts:add-button',       placement: 'bottom-end' },
    { anchor: 'accounts:starting-balance', placement: 'bottom-start' },
  ],
  imports: [
    { anchor: 'imports:dropzone', placement: 'bottom' },
  ],
  transactions: [
    { anchor: 'transactions:search',       placement: 'bottom-start' },
    { anchor: 'transactions:multi-select', placement: 'bottom-start' },
    { anchor: 'transactions:row',          placement: 'bottom-start' },
  ],
  rules: [
    { anchor: 'rules:list',    placement: 'bottom-start' },
    { anchor: 'rules:tri-tab', placement: 'bottom' },
  ],
  budgets: [
    { anchor: 'budgets:category-row', placement: 'bottom-start' },
  ],
  data: [
    { anchor: 'data:export', placement: 'bottom-start' },
  ],
  'budgets-envelopes': [
    { anchor: 'budgets-envelopes:overview', placement: 'bottom-end' },
    { anchor: 'budgets-envelopes:hold',     placement: 'bottom-end' },
  ],
  'rules-list': [
    { anchor: 'rules-list:overview', placement: 'bottom-end' },
    { anchor: 'rules-list:reapply',  placement: 'bottom-end' },
  ],
  'rules-categories': [
    { anchor: 'rules-categories:list',   placement: 'bottom-end' },
    { anchor: 'rules-categories:create', placement: 'bottom-end' },
  ],
  'recurring-detected': [
    { anchor: 'recurring-detected:list',    placement: 'bottom-end' },
    { anchor: 'recurring-detected:confirm', placement: 'bottom-end' },
  ],
  'recurring-upcoming': [
    { anchor: 'recurring-upcoming:list',      placement: 'bottom-end' },
    { anchor: 'recurring-upcoming:month-nav', placement: 'bottom-end' },
  ],
  'recurring-forecast': [
    { anchor: 'recurring-forecast:chart', placement: 'bottom-end' },
    { anchor: 'recurring-forecast:scope', placement: 'bottom-end' },
  ],
  'data-duplicates': [
    { anchor: 'data-duplicates:list',   placement: 'bottom-end' },
    { anchor: 'data-duplicates:action', placement: 'bottom-end' },
  ],
  'data-pdf-templates': [
    { anchor: 'data-pdf-templates:list',   placement: 'bottom-end' },
    { anchor: 'data-pdf-templates:import', placement: 'bottom-end' },
  ],
};
