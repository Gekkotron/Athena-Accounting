# Tips system v2 — anchored per-page guided tours

**Date:** 2026-07-20
**Status:** Design approved, pending implementation plan
**Owner:** Gekkotron
**Supersedes:** `2026-07-16-tips-system-design.md` (v1 — inline banner + welcome modal)

## Summary

Replace the current tips system with a **per-page guided tour** made of small
anchored bubbles that point at the exact UI element they describe.

For each of the seven main pages (Dashboard, Accounts, Imports, Transactions,
Rules, Budgets, Data), the first visit auto-opens a short walkthrough of up
to five steps; each step is a bubble anchored to a specific control or widget
on the page, with `Précédent` / `Suivant` / `Passer` controls and a step
counter. Once the tour is completed or skipped, dismissal is persisted
server-side per user, and a small `?` icon next to the page title lets the
user replay it.

Some tours are **data-gated**: they only auto-start once the page has enough
data to make each step meaningful. For example, the Dashboard tour describes
the balance curve, the category donut, and the cash-flow Sankey — all empty
until at least one transaction exists, at which point every widget the tour
points to is populated. The gate is a per-tour predicate; the `?` replay
icon bypasses it (an explicit user request always shows the tour).

Only one tour runs at a time. Navigating away mid-tour aborts (does not
persist). There is no modal welcome tour — new users learn each page in
context, on first visit.

## Motivation

The v1 system (a 4-step welcome modal at first app boot + inline banners at
the top of each page) shipped an "orientation lecture" that was decoupled
from the UI it described. Users have to remember four screens of copy before
the first click, and the inline banners consume vertical real estate on every
page without a way to point at what they mention.

v2 restructures the same content into anchored coach-marks so each hint
appears next to the thing it describes, exactly when the user is looking at
it. The onboarding becomes progressive and contextual instead of upfront.

The v1 spec explicitly listed coach-marks as a non-goal ("brittle to
redesigns"). This spec reverses that call for three reasons:

1. The app UI has stabilised — refactor work is now targeted, not layout-wide.
2. The anchor mechanism is a typed hook (`useTourAnchor(id)`), not a CSS
   selector — a renamed anchor is a compile error, not a silent break.
3. Anchor-missing at run time is handled explicitly (skip step after a short
   grace window), so a briefly-unmounted target degrades gracefully instead
   of freezing the tour.

## Non-goals

- Internationalisation beyond the existing `en` / `fr` locales.
- A modal welcome tour of any kind — v2 removes the v1 welcome modal entirely.
- Version-based "what's new" tips. Separate feature if ever wanted.
- Per-tip usage analytics. LAN-only self-hosted; no telemetry anywhere.
- Cross-page tours. A tour lives inside one page; a route change aborts it.
- Dark-backdrop spotlight / focus trap. The app stays fully usable while a
  bubble is up — this is a coach-mark, not a modal.
- Visual regression tests. The project doesn't ship them today; not the
  moment to add.
- A per-user "skip all tours forever" master switch. YAGNI — each tour can
  be dismissed individually in the same click as reading it.

## Architecture

Five small units, each with one job.

### 1. `frontend/src/tips/tours.ts` — content registry

Exports `PageId`, `AnchorId`, `TourStep`, and a `TOURS: Record<PageId,
TourStep[]>` registry that lists each tour's structure (anchor + placement).
Copy stays in `locales/{en,fr}/tips.json` under a new `tours` root — the
registry references it by index (`tours.{pageId}[stepIdx].{title,body}`).

```ts
export type PageId =
  | 'dashboard' | 'accounts' | 'imports' | 'transactions'
  | 'rules' | 'budgets' | 'data';

export type AnchorId =
  | 'dashboard:balance' | 'dashboard:curve' | 'dashboard:donut'
  | 'dashboard:insights' | 'dashboard:sankey'
  | 'accounts:add-button' | 'accounts:starting-balance'
  | 'imports:dropzone'
  | 'transactions:search' | 'transactions:row' | 'transactions:multi-select'
  | 'rules:list' | 'rules:tri-tab'
  | 'budgets:category-row'
  | 'data:export';

export type Placement =
  | 'top' | 'bottom' | 'left' | 'right'
  | 'top-start' | 'top-end'
  | 'bottom-start' | 'bottom-end'
  | 'left-start' | 'right-start';

export interface TourStep {
  anchor: AnchorId;
  placement?: Placement; // defaults to 'bottom-start'
}

export const TOURS: Record<PageId, TourStep[]> = { /* see § Content */ };
```

### 2. `frontend/src/contexts/TourContext.tsx` — provider

Holds the running-tour state and exposes imperative actions. One tour active
at a time; starting a new one aborts the previous.

```ts
interface TourContextValue {
  activePageId: PageId | null;
  stepIdx: number;
  registerAnchor: (id: AnchorId, el: HTMLElement | null) => void;
  getAnchor: (id: AnchorId) => HTMLElement | null;
  anchorVersion: number; // bumps on every register/unregister
  startTour: (pageId: PageId) => void;
  nextStep: () => void;
  prevStep: () => void;
  finishTour: () => void; // called by "Terminer" on last step; persists dismiss
  skipTour: () => void;   // called by "Passer" / "×" / Esc; persists dismiss
  abortTour: () => void;  // called on route change; does NOT persist
}
```

Skip / finish / close (`×`) / `Esc` are equivalent — all call
`dismiss('tour:' + activePageId)` via `TipsContext` and clear `activePageId`.
`abortTour` clears `activePageId` without a persistence event.

### 3. `frontend/src/hooks/useTourAnchor.ts`

Ref-callback hook that target elements call to register their DOM node with
the provider:

```ts
export function useTourAnchor(id: AnchorId): RefCallback<HTMLElement>;
```

Behaviour: on mount, calls `registerAnchor(id, node)`; on unmount, calls
`registerAnchor(id, null)`. Type-safe at call sites (`AnchorId` union) — a
typo is a compile error. No `document.querySelector` at bubble render time.

If an anchor is registered from two places (e.g. `accounts:add-button` in
both the header and the empty-state CTA), last-register-wins — the empty
state, being conditionally mounted, effectively takes over when it is
visible.

### 4. `frontend/src/components/TourBubble.tsx`

The visible popover, mounted once at the app root inside `TourProvider`.
Reads active step from context, resolves its anchor via `getAnchor`, uses
`@floating-ui/react`'s `useFloating` with middleware
`offset(10) → flip() → shift({padding: 8}) → arrow(...)` and `autoUpdate`
for reactive placement. Portalled to `document.body` so ancestor
`overflow: hidden` cannot clip it.

Renders:

- Title (`text-ink-100`, `text-sm`, `font-medium`)
- Body (`text-ink-400`, `text-sm`, `leading-relaxed`)
- Step counter (`Étape 2 / 3` — reuses today's `tour.stepCounter` i18n key)
- Buttons: `Précédent` (disabled on step 0), `Suivant` or `Terminer`
  (last step), `Passer`, `×`
- Arrow (`.tour-arrow`, 12 px, coloured to match `surface-soft`)

Max-width 320 px. Same visual family as existing `BalanceTooltip` — dark
`surface-soft` background, subtle border, rounded 12 px.

A11y: focus moves to the bubble on step change; `Esc` skips; `←` / `→` step;
focus returns to the anchor on close. `role="dialog"`, `aria-labelledby`
pointing at the title id.

Mobile (viewport < 640 px): bubble docks to the viewport bottom with an
inline "↑ pointe vers ..." indicator inside the bubble border instead of an
arrow. Same content, simpler positioning; no floating-math required for
tiny screens.

### 5. `frontend/src/components/TourReplayIcon.tsx`

Small `?` icon rendered next to each page's `<h1>` title. Visible only when
`isDismissed('tour:<pageId>')` is `true`. On click:

1. `undismiss('tour:' + pageId)` (optimistic, via `TipsContext`).
2. `startTour(pageId)`.

If the API call fails, `TipsContext` rolls back optimistically. The tour has
already started, so the user got their replay; the icon may reappear on next
reload — acceptable degradation.

Replaces `SectionTipHelpIcon` byte-for-byte in the DOM footprint (same
placement, same tooltip, same look).

### Provider tree

```
<TipsProvider>                       // existing, ids widened by union
  <TourProvider>                     // new
    …
    <TourBubble />                   // new, mounted at root, portalled
    <RoutedApp>
      <DashboardPage>
        <h1>Tableau de bord</h1><TourReplayIcon pageId="dashboard" />
        useAutoStartTour('dashboard')
        <div ref={useTourAnchor('dashboard:balance')}>…</div>
        <div ref={useTourAnchor('dashboard:curve')}>…</div>
        <div ref={useTourAnchor('dashboard:donut')}>…</div>
      </DashboardPage>
      …
    </RoutedApp>
  </TourProvider>
</TipsProvider>
```

## Anchors, positioning, and edge cases

### Anchor identifiers

`AnchorId` (see § Architecture) — a discriminated union of
`<pageId>:<slot>` strings. Enumerated once, imported everywhere. Adding a
step to a tour means adding an id to the union, one line to the target
component's ref, and one entry to the content registry — no free-form
strings, no selectors.

### Positioning

`@floating-ui/react` (peer dep `react` ≥ 17, already satisfied). Middleware
chain, in order: `offset(10)`, `flip()`, `shift({ padding: 8 })`, `arrow()`.
`autoUpdate` on every step change and on scroll / resize.

Default placement is `bottom-start`; each `TourStep` may override. Concrete
overrides in § Content model.

### Anchor missing at step time

Two real cases:

1. **Empty state** (e.g. Accounts with zero accounts — no header add-button;
   CTA lives in the middle of the page). Handled by registering the same
   `AnchorId` from both mount points; last-mounted-wins gives us the empty
   state automatically because the header is unmounted while empty.
2. **Async load** (e.g. Dashboard widgets that mount after a data fetch).
   The `TourBubble` renders `null` while the anchor is unresolved. When
   `useTourAnchor` fires its ref callback, `anchorVersion` bumps and the
   bubble re-renders positioned.

If **more than 2 s** elapse with no registration for the current step's
anchor, `TourProvider` skips that step (`nextStep()`). If there is no next
step, the tour finishes normally (and persists dismissal). A single
`setTimeout`, cleared on step change and on anchor resolution.

### Mid-tour route change

`TourProvider` listens for route changes (via `useLocation` from
`react-router-dom`, whichever router the app uses — verify at implementation
time). Any change while `activePageId != null` calls `abortTour()`. No
persistence event. Next visit to the same page re-triggers auto-start.

### Viewport / scroll

When `stepIdx` changes, if the resolved anchor is outside the viewport, call
`scrollIntoView({ block: 'center', behavior: 'smooth' })` once. Floating UI's
`autoUpdate` handles the rest. No auto-scroll on the very first step (avoid
a page-load jump).

## Content model

### Locale file shape (`locales/{en,fr}/tips.json`)

The current `sections` and `welcome` blocks are removed and replaced with:

```json
{
  "tours": {
    "dashboard": [
      { "title": "Solde global", "body": "Somme des soldes de tous vos comptes, argent bloqué inclus." },
      { "title": "Courbe du solde", "body": "L'évolution jour par jour. Les losanges sont vos points de contrôle." },
      { "title": "Dépenses par catégorie", "body": "Cliquez sur une part du donut pour filtrer les transactions." },
      { "title": "Insights", "body": "Les alertes automatiques : catégories en dépassement, dépenses inhabituelles, budgets à ajuster." },
      { "title": "Flux de trésorerie", "body": "Le Sankey retrace d'où vient l'argent et où il va sur la période affichée." }
    ],
    "accounts": [
      { "title": "Ajouter un compte", "body": "Courant, livret, PEA… Le solde de départ est obligatoire — tous les calculs partent de là." },
      { "title": "Argent bloqué", "body": "PEA, dépôt à terme : cochez « bloqué » pour l'isoler du montant disponible." }
    ],
    "imports": [
      { "title": "Glissez un fichier", "body": "OFX, CSV ou PDF. La première fois qu'un PDF d'une banque arrive, un assistant vous demande de désigner les zones montant/date/libellé." }
    ],
    "transactions": [
      { "title": "Recherche", "body": "La recherche ignore les accents et la casse." },
      { "title": "Ventiler une transaction", "body": "Ouvrez une transaction pour la découper en plusieurs sous-lignes, ou éditez une catégorie en ligne." },
      { "title": "Sélection multiple", "body": "Cochez plusieurs lignes pour les supprimer d'un coup." }
    ],
    "rules": [
      { "title": "Règles de tri", "body": "Les règles s'appliquent aux nouveaux imports et peuvent être ré-appliquées rétroactivement sans écraser vos catégories manuelles." },
      { "title": "Onglet Tri", "body": "Créez une règle à partir d'un mot-clé en un clic." }
    ],
    "budgets": [
      { "title": "Budget mensuel", "body": "Définissez un montant prévu par catégorie. Les dépassements passent au rouge." }
    ],
    "data": [
      { "title": "Sauvegarde complète", "body": "Exportez comptes, transactions, checkpoints et ventilations en un fichier. Ré-importez sur une autre installation pour restaurer." }
    ]
  },
  "tour": {
    "stepCounter": "Étape {{step}} / {{total}}",
    "buttons": {
      "prev": "Précédent",
      "next": "Suivant",
      "finish": "Terminer",
      "skip": "Passer"
    },
    "replayIconAriaLabel": "Rejouer la visite de cette page"
  }
}
```

`en/tips.json` mirrors the same keys with polished English copy — same
concise imperative tone as the current section tips.

### Structural registry (`TOURS` in `tours.ts`)

```ts
export const TOURS: Record<PageId, TourStep[]> = {
  dashboard: [
    { anchor: 'dashboard:balance',  placement: 'bottom-start' },
    { anchor: 'dashboard:curve',    placement: 'top' },
    { anchor: 'dashboard:donut',    placement: 'left' },
    { anchor: 'dashboard:insights', placement: 'right' },
    { anchor: 'dashboard:sankey',   placement: 'top' },
  ],
  accounts: [
    { anchor: 'accounts:add-button',       placement: 'bottom-end' },
    { anchor: 'accounts:starting-balance', placement: 'right' },
  ],
  imports:      [{ anchor: 'imports:dropzone', placement: 'bottom' }],
  transactions: [
    { anchor: 'transactions:search',       placement: 'bottom-start' },
    { anchor: 'transactions:row',          placement: 'right' },
    { anchor: 'transactions:multi-select', placement: 'right' },
  ],
  rules: [
    { anchor: 'rules:list',    placement: 'bottom-start' },
    { anchor: 'rules:tri-tab', placement: 'bottom' },
  ],
  budgets: [{ anchor: 'budgets:category-row', placement: 'right' }],
  data:    [{ anchor: 'data:export',          placement: 'bottom-start' }],
};
```

Structure (`TOURS`) and copy (`tips.json`) split follows the existing pattern
established by `sectionTip()` in `frontend/src/tips/content.ts`.

**Soft ceiling of 5 steps per tour.** A guideline, not a code constraint —
enforced by review, not by the type system. Beyond 5 steps a tour stops
feeling like a coach-mark and starts feeling like a course; if a page ever
needs more, it's a signal to split the page or the tour instead.

## Trigger, persistence, and interaction

### Auto-start on first visit

Each page component calls `useAutoStartTour('<pageId>', opts?)` once. The
hook runs one effect that:

1. Waits for `TipsContext.ready === true`.
2. Checks `!isDismissed('tour:<pageId>')`.
3. Checks `TourContext.activePageId === null`.
4. If `opts.requireData` is provided, checks that it returns `true`.
5. If all pass, calls `startTour(pageId)`.

Effect deps are `[ready, dismissed, requireData?()]` — navigating away and
back re-runs the effect, but step 2 short-circuits once the tour is
dismissed. If `requireData` returns `false`, the effect stays subscribed
and re-fires when its inputs change; the tour will kick in the moment the
data threshold is crossed.

### Data gating (per-tour)

Some tours describe widgets that are empty without user data — auto-showing
them on a blank slate would point at nothing. The `useAutoStartTour` hook
accepts an optional `requireData` predicate; the tour auto-starts only once
it returns `true`.

Concrete assignments (v1):

| Tour | `requireData` |
|---|---|
| `dashboard` | at least one transaction exists on the current page range (reuse the existing `!rootEmpty` signal at `frontend/src/pages/Dashboard/index.tsx:195`) |
| `transactions` | at least one transaction row exists |
| `budgets` | at least one budget row is defined |
| `accounts`, `imports`, `rules`, `data` | none — these pages exist *to* create data, auto-start is appropriate on an empty slate |

The predicate reads from the page's already-loaded data (React Query cache
or props), so no extra fetches. If the predicate throws, treat as `false`
(fail closed: no auto-start).

**Replay bypasses the gate.** When the user clicks the `?` icon,
`TourReplayIcon` calls `undismiss` + `startTour` directly — `requireData` is
not consulted. Rationale: the user has explicitly asked for the tour;
respect the request even on an empty dataset. Steps whose anchors aren't
mounted will fall through the 2 s anchor-missing timeout described in
§ Anchors.

### Persistence ids

New `TipId` union members, added to both `frontend/src/tips/content.ts`
and `backend/src/http/routes/tips/tip-ids.ts`:

```
tour:dashboard   tour:accounts   tour:imports   tour:transactions
tour:rules       tour:budgets    tour:data
```

Old ids (`welcome_tour`, `section:*`) are **removed** from both allowlists in
the same commit. The existing lock-step Vitest is updated accordingly.

### Dismissal semantics

| User action | Effect |
|---|---|
| `Terminer` on last step | `dismiss('tour:<page>')` + close bubble |
| `Passer` (skip button)  | Same as Terminer |
| `×` (close icon)        | Same as Passer |
| `Esc` key               | Same as Passer |
| Route change mid-tour   | Abort (no persistence event); auto-starts again on next visit |

Rationale: one persistence event per tour, at explicit exit only. Matches
today's `SectionTip` semantics (only `×` persists; closing the tab does
not).

### Replay

`<TourReplayIcon pageId="..." />` next to each page title. Visible only
when the tour is dismissed. Click → `undismiss` (optimistic) + `startTour`.

### One tour at a time

If the user clicks a nav link mid-tour, the active tour aborts, the new
page mounts, `useAutoStartTour` fires only if the new tour isn't dismissed.
No two bubbles ever coexist.

## Migration & cleanup

All in one commit. No feature flag — LAN-only app, small user base, partial
rollout adds branching without safety benefit.

### Files to add

- `frontend/src/tips/tours.ts`
- `frontend/src/contexts/TourContext.tsx`
- `frontend/src/components/TourBubble.tsx`
- `frontend/src/components/TourReplayIcon.tsx`
- `frontend/src/hooks/useTourAnchor.ts`
- `frontend/src/hooks/useAutoStartTour.ts`
- `frontend/src/tips/__tests__/tours.test.ts`
- `frontend/src/contexts/__tests__/TourContext.test.tsx`
- `frontend/src/hooks/__tests__/useAutoStartTour.test.tsx`
- `frontend/src/components/__tests__/TourBubble.test.tsx`
- `frontend/src/components/__tests__/TourReplayIcon.test.tsx`

### Files to delete

- `frontend/src/components/SectionTip.tsx` and its `__tests__`.
- `frontend/src/components/SectionTipHelpIcon.tsx` and its `__tests__`.
- The `welcome`, `sections`, `sectionTip`, and `sectionTipHelpIcon` blocks
  in `locales/en/tips.json` and `locales/fr/tips.json` (everything except
  the new `tours` and `tour` blocks).
- Whichever component renders the welcome modal at app boot (grep for
  `welcome_tour` — likely `WelcomeTour.tsx` under `frontend/src/components`
  or wired into `App.tsx`). Delete it and its wiring.

### Files to modify

- **7 page components**:
  - `frontend/src/pages/Dashboard/index.tsx`
  - `frontend/src/pages/Accounts/index.tsx`
  - `frontend/src/pages/Transactions/index.tsx`
  - `frontend/src/pages/Data/Imports.tsx`
  - `frontend/src/pages/Rules/Tri.tsx`
  - `frontend/src/pages/Budgets/Plafonds.tsx`
  - `frontend/src/pages/Data/Backup.tsx`

  In each: remove `<SectionTip>` / `<SectionTipHelpIcon>`; add
  `<TourReplayIcon pageId="…">` next to `<h1>`; add `useAutoStartTour('…')`;
  attach `useTourAnchor('…:…')` refs to the elements each step targets.

- **Root layout / `App.tsx`**: wrap children in `<TourProvider>`, mount
  `<TourBubble />` at the tree root.
- **`frontend/src/tips/content.ts`**: trim `TIP_IDS` to the empty case;
  remove the `SECTION_KEY` map, `sectionTip()` helper, `welcomeStep()`
  helper, and `WELCOME_STEP_COUNT` constant (no callers after the deletions
  above). If the file becomes trivial, fold what remains into `tours.ts`.
  Decision at implementation time.
- **`frontend/src/contexts/TipsContext.tsx`**: no code change; `TipId` union
  is widened via the imports.
- **`backend/src/http/routes/tips/tip-ids.ts`**: replace 8 old ids with 7
  new `tour:*` ids. Extend the existing lock-step Vitest.
- Any backend code special-casing `welcome_tour` or `section:*` — grep and
  remove.

### Orphan-row cleanup

The `tips_dismissed` table (or equivalent — verify shape at implementation
time) will hold rows with old ids after this deploy. Add a one-shot startup
DELETE that removes rows whose `id` is not in the current allowlist. One
query at backend boot, runs to completion, keeps the table honest.

Users who visit a page after upgrade will see the new tour once — that's
the desired "here's what's new" behaviour.

## Testing strategy

### Unit

- `tips/__tests__/tours.test.ts`
  - Every `PageId` has ≥ 1 step.
  - Every `TourStep.anchor` is a member of the `AnchorId` union
    (runtime scan defends against `as any` casts).
  - For every step, `tours.{pageId}[stepIdx].title` and `.body` resolve to
    non-empty strings in both `en` and `fr`.
- `contexts/__tests__/TourContext.test.tsx`
  - `startTour` sets `activePageId` and resets `stepIdx = 0`.
  - `nextStep` / `prevStep` clamp at bounds.
  - `finishTour` / `skipTour` both call `TipsContext.dismiss` and clear
    `activePageId`.
  - `abortTour` clears without dismissing.
  - Starting a new tour while one runs aborts the first (no persistence
    event on the abort).
- `hooks/__tests__/useAutoStartTour.test.tsx`
  - Auto-starts when `ready` + `!dismissed` + no active tour + no
    `requireData` predicate.
  - Does NOT auto-start when `requireData` returns `false`; auto-starts on
    the next render once it flips to `true`.
  - Treats a throwing `requireData` as `false` (no auto-start, no crash).
  - Never auto-starts once the tour is dismissed, regardless of
    `requireData`.

### Component

- `components/__tests__/TourBubble.test.tsx`
  - Renders `null` when no anchor registered.
  - Renders title/body/step-counter/buttons when active + anchor resolved.
  - Clicking `Suivant` advances; `Précédent` steps back.
  - Last-step `Suivant` renders as `Terminer` and calls `finishTour`.
  - `Esc` calls `skipTour`.
- `components/__tests__/TourReplayIcon.test.tsx`
  - Hidden when `!isDismissed`.
  - Visible when `isDismissed`; click → `undismiss` + `startTour`.

### Integration

One RTL flow per page:

1. Mount page with a fresh `TipsContext` (no dismissals).
2. Expect the first bubble to render, positioned near its anchor.
3. Click through all steps.
4. Expect `POST /api/tips/dismiss { id: 'tour:<page>' }` fired (mocked).
5. Expect `<TourReplayIcon>` visible.
6. Click the icon; expect the bubble to reopen at step 0.

## Risks & open questions

- **Router library**: implementation must check whether the app uses
  `react-router-dom` v6, TanStack Router, or something else, to wire the
  route-change abort listener. Grep at plan time.
- **Empty-state anchor duplication**: registering `accounts:add-button`
  from two places relies on last-register-wins. If both mount briefly
  during a transition, positioning may flicker for one frame. Acceptable
  — no worse than the anchor-missing fallback.
- **Focus management on mobile docked bubble**: `role="dialog"` with a
  bottom-docked non-modal element is unusual. Verify VoiceOver / TalkBack
  reads it in order at implementation time; if it doesn't, drop
  `role="dialog"` on the mobile layout and rely on live-region
  announcements.
- **Portalled bubble + z-index**: existing modals in the app use their own
  z-index scale. Bubble sits above content but below any open modal
  (a modal + tour bubble simultaneously would be confusing). Verify at
  implementation time; may need a single `z-tour` token in the Tailwind
  config.
- **Bundle-size cost of `@floating-ui/react`**: ~10 KB gzipped last
  measured. Acceptable — it replaces hand-rolled positioning code we would
  otherwise need to write and test.

## Future work (explicitly deferred)

- Version-based "what's new" tips.
- Per-tour completion telemetry (would need a telemetry surface that
  doesn't exist).
- Cross-page onboarding sequences.
- Tour "milestones" that only trigger after N accounts / N transactions
  exist (currently, first-visit is the only trigger).
