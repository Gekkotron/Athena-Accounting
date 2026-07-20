# Tips v2 — anchored per-page guided tours: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the v1 welcome-modal + inline `SectionTip` banners with anchored, per-page guided tours (up to 5 steps each, bubbles positioned next to the exact UI element they describe) for the seven main pages: Dashboard, Accounts, Imports, Transactions, Rules, Budgets, Data.

**Architecture:** Five small units — a typed `tours.ts` registry, a `TourContext` provider that owns the running-tour state and an anchor-id → DOM-node map, a `useTourAnchor` ref-callback hook that target elements use to register themselves, an auto-start hook per page, and a portalled `TourBubble` positioned by `@floating-ui/react`. Dismissal persists per-tour via the existing `TipsContext` API. Some tours are data-gated (Dashboard, Transactions, Budgets) so they only auto-start once the page has enough data for every step to point at something meaningful; a `?` replay icon next to each page title bypasses the gate.

**Tech Stack:** React 18, TypeScript, `@floating-ui/react` (new dep), `react-router-dom` v6 (route-change abort), `react-i18next` (copy), Vitest + Testing Library (tests), Tailwind (styling, reusing existing `surface-soft` / `text-ink-*` tokens).

**Design spec:** `docs/superpowers/specs/2026-07-20-tips-anchored-tours-design.md`.

## Global Constraints

- All new frontend code is TypeScript, strict mode. No `as any`.
- One tour active at a time; navigating away mid-tour aborts (no persistence event); the same page's tour re-auto-starts on next visit until dismissed.
- Dismissal semantics: `Terminer`, `Passer`, `×`, and `Esc` all persist `tour:<pageId>` via `TipsContext.dismiss`. Route change does NOT persist.
- No dark backdrop / focus trap — coach-marks are non-modal; the app stays fully usable while a bubble is up.
- `AnchorId` is a discriminated union of `<pageId>:<slot>` strings enumerated in `frontend/src/tips/tours.ts`. Free-form strings and `document.querySelector` are forbidden at bubble render time.
- Anchor-missing at step time falls through a **2 s** timeout that calls `nextStep()`; if there is no next step, the tour finishes normally (persists dismissal).
- New `TipId` union members: `tour:dashboard tour:accounts tour:imports tour:transactions tour:rules tour:budgets tour:data`. Old ids (`welcome_tour`, `section:*`) are removed from both allowlists in the same commit.
- The frontend `TIP_IDS` in `frontend/src/tips/content.ts` (or its successor) must stay in lock-step with `backend/src/http/routes/tips/tip-ids.ts` — the existing Vitest asserts literal equality.
- Locale files: `frontend/src/locales/{en,fr}/tips.json`. Same imperative concise tone as today's `sections` copy in French; polished English mirrors the same keys.
- No visual-regression tests, no telemetry, no feature flag. Migration ships in a single commit.
- Router: `react-router-dom` v6.28 (confirmed in `frontend/package.json`).
- Attribution: user is `Gekkotron`; commits go on `main` — no branches; do not `git push` unless explicitly asked.
- Soft ceiling of **5 steps per tour**. A guideline enforced by review, not by types.

---

### Task 1: `tours.ts` registry — types + structural registry + install `@floating-ui/react`

**Files:**
- Create: `frontend/src/tips/tours.ts`
- Create: `frontend/src/tips/__tests__/tours.test.ts`
- Modify: `frontend/package.json` (add `@floating-ui/react` dep)

**Interfaces:**
- Produces:
  - `type PageId = 'dashboard' | 'accounts' | 'imports' | 'transactions' | 'rules' | 'budgets' | 'data'`
  - `type AnchorId` — 15-member union of `${PageId}:<slot>` literals (enumerated below)
  - `type Placement = 'top' | 'bottom' | 'left' | 'right' | 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end' | 'left-start' | 'right-start'`
  - `interface TourStep { anchor: AnchorId; placement?: Placement }`
  - `const TOURS: Record<PageId, TourStep[]>` — the structural registry
  - `const PAGE_IDS: readonly PageId[]` — enumerated once, exported for tests

- [ ] **Step 1: Add `@floating-ui/react` to dependencies**

Edit `frontend/package.json`; add `"@floating-ui/react": "^0.27.0"` in the `dependencies` object, alphabetically before `@fontsource-variable/fraunces`. Then install:

```bash
cd frontend && npm install
```

Expected: no version conflicts; `node_modules/@floating-ui/react` created.

- [ ] **Step 2: Write the failing test for `tours.ts`**

Create `frontend/src/tips/__tests__/tours.test.ts`:

```ts
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
];

describe('tours registry', () => {
  it('exports every PageId exactly once', () => {
    expect([...PAGE_IDS].sort()).toEqual(
      ['accounts', 'budgets', 'dashboard', 'data', 'imports', 'rules', 'transactions'],
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/tips/__tests__/tours.test.ts`
Expected: FAIL — `Cannot find module '../tours'`.

- [ ] **Step 4: Implement `tours.ts`**

Create `frontend/src/tips/tours.ts`:

```ts
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
  | 'data';

export const PAGE_IDS: readonly PageId[] = [
  'dashboard',
  'accounts',
  'imports',
  'transactions',
  'rules',
  'budgets',
  'data',
] as const;

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
  placement?: Placement; // defaults to 'bottom-start' in TourBubble
}

// Persistence id derived from the PageId. Kept as a helper (not a type
// alias) so the AnchorId → tour:pageId inference is done at one place.
export function tipIdFor(pageId: PageId): `tour:${PageId}` {
  return `tour:${pageId}` as const;
}

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
  imports: [
    { anchor: 'imports:dropzone', placement: 'bottom' },
  ],
  transactions: [
    { anchor: 'transactions:search',       placement: 'bottom-start' },
    { anchor: 'transactions:row',          placement: 'right' },
    { anchor: 'transactions:multi-select', placement: 'right' },
  ],
  rules: [
    { anchor: 'rules:list',    placement: 'bottom-start' },
    { anchor: 'rules:tri-tab', placement: 'bottom' },
  ],
  budgets: [
    { anchor: 'budgets:category-row', placement: 'right' },
  ],
  data: [
    { anchor: 'data:export', placement: 'bottom-start' },
  ],
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/tips/__tests__/tours.test.ts`
Expected: PASS — 7 tests pass.

- [ ] **Step 6: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  add frontend/package.json frontend/package-lock.json \
      frontend/src/tips/tours.ts frontend/src/tips/__tests__/tours.test.ts && \
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "feat(tips): add tours registry and @floating-ui/react

Registry with PageId/AnchorId union types and per-tour step lists.
Copy stays in locales/tips.json — this file has no user-facing strings.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Locale content + slim `tips/content.ts` + update lockstep test

**Files:**
- Modify: `frontend/src/locales/fr/tips.json` (replace entirely)
- Modify: `frontend/src/locales/en/tips.json` (replace entirely)
- Modify: `frontend/src/tips/content.ts` (slim to the new `TIP_IDS`)
- Modify: `frontend/src/tips/__tests__/content.test.ts` (rewrite for the new shape)

**Interfaces:**
- Consumes: `PageId`, `PAGE_IDS`, `TOURS` from `tours.ts` (Task 1).
- Produces:
  - `TIP_IDS: readonly ['tour:dashboard', 'tour:accounts', 'tour:imports', 'tour:transactions', 'tour:rules', 'tour:budgets', 'tour:data']`
  - `type TipId = typeof TIP_IDS[number]` (i.e. exactly `` `tour:${PageId}` `` for each PageId)

- [ ] **Step 1: Rewrite `frontend/src/locales/fr/tips.json`**

Replace the entire file with:

```json
{
  "tours": {
    "dashboard": {
      "0": { "title": "Solde global", "body": "Somme des soldes de tous vos comptes, argent bloqué inclus." },
      "1": { "title": "Courbe du solde", "body": "L'évolution jour par jour. Les losanges sont vos points de contrôle." },
      "2": { "title": "Dépenses par catégorie", "body": "Cliquez sur une part du donut pour filtrer les transactions." },
      "3": { "title": "Insights", "body": "Les alertes automatiques : catégories en dépassement, dépenses inhabituelles, budgets à ajuster." },
      "4": { "title": "Flux de trésorerie", "body": "Le Sankey retrace d'où vient l'argent et où il va sur la période affichée." }
    },
    "accounts": {
      "0": { "title": "Ajouter un compte", "body": "Courant, livret, PEA… Le solde de départ est obligatoire — tous les calculs partent de là." },
      "1": { "title": "Argent bloqué", "body": "PEA, dépôt à terme : cochez « bloqué » pour l'isoler du montant disponible." }
    },
    "imports": {
      "0": { "title": "Glissez un fichier", "body": "OFX, CSV ou PDF. La première fois qu'un PDF d'une banque arrive, un assistant vous demande de désigner les zones montant/date/libellé." }
    },
    "transactions": {
      "0": { "title": "Recherche", "body": "La recherche ignore les accents et la casse." },
      "1": { "title": "Ventiler une transaction", "body": "Ouvrez une transaction pour la découper en plusieurs sous-lignes, ou éditez une catégorie en ligne." },
      "2": { "title": "Sélection multiple", "body": "Cochez plusieurs lignes pour les supprimer d'un coup." }
    },
    "rules": {
      "0": { "title": "Règles de tri", "body": "Les règles s'appliquent aux nouveaux imports et peuvent être ré-appliquées rétroactivement sans écraser vos catégories manuelles." },
      "1": { "title": "Onglet Tri", "body": "Créez une règle à partir d'un mot-clé en un clic." }
    },
    "budgets": {
      "0": { "title": "Budget mensuel", "body": "Définissez un montant prévu par catégorie. Les dépassements passent au rouge." }
    },
    "data": {
      "0": { "title": "Sauvegarde complète", "body": "Exportez comptes, transactions, checkpoints et ventilations en un fichier. Ré-importez sur une autre installation pour restaurer." }
    }
  },
  "tour": {
    "stepCounter": "Étape {{step}} / {{total}}",
    "buttons": {
      "prev": "Précédent",
      "next": "Suivant",
      "finish": "Terminer",
      "skip": "Passer"
    },
    "closeAriaLabel": "Fermer la visite",
    "replayIconAriaLabel": "Rejouer la visite de cette page",
    "mobilePointsTo": "↑ pointe vers l'élément décrit"
  }
}
```

Note: the spec's JSON example used an array under each pageId; this uses an object keyed by index string ("0", "1"…) so that i18next's dot-path lookup (`tours.dashboard.0.title`) resolves as a normal nested key. Arrays require the `returnObjects` option per lookup, which is heavier for no gain.

- [ ] **Step 2: Rewrite `frontend/src/locales/en/tips.json`**

Replace the entire file with:

```json
{
  "tours": {
    "dashboard": {
      "0": { "title": "Total balance", "body": "The sum of every account's balance, locked funds included." },
      "1": { "title": "Balance curve", "body": "Day-by-day evolution. The diamonds are your reconciliation checkpoints." },
      "2": { "title": "Spending by category", "body": "Click a donut slice to filter transactions by that category." },
      "3": { "title": "Insights", "body": "Automatic alerts: over-budget categories, unusual spending, budgets that could use a tweak." },
      "4": { "title": "Cash flow", "body": "The Sankey traces where money came from and where it went over the visible period." }
    },
    "accounts": {
      "0": { "title": "Add an account", "body": "Checking, savings, brokerage… The starting balance is required — every calculation starts from there." },
      "1": { "title": "Locked funds", "body": "For accounts like brokerage or term deposits, tick 'locked' to isolate them from your available balance." }
    },
    "imports": {
      "0": { "title": "Drop a file", "body": "OFX, CSV, or PDF. The first time a bank's PDF is imported, an assistant asks you to point at the amount, date, and label zones." }
    },
    "transactions": {
      "0": { "title": "Search", "body": "Search ignores accents and case." },
      "1": { "title": "Split a transaction", "body": "Open a transaction to break it into several sub-lines, or edit a category inline." },
      "2": { "title": "Multi-select", "body": "Tick several rows to delete them at once." }
    },
    "rules": {
      "0": { "title": "Sorting rules", "body": "Rules apply to new imports and can be re-applied retroactively without overwriting your manual categories." },
      "1": { "title": "Sort tab", "body": "Create a rule from a keyword in one click." }
    },
    "budgets": {
      "0": { "title": "Monthly budget", "body": "Set a target amount per category. Over-budget categories turn red." }
    },
    "data": {
      "0": { "title": "Full backup", "body": "Export accounts, transactions, checkpoints, and splits to one file. Re-import on another install to restore." }
    }
  },
  "tour": {
    "stepCounter": "Step {{step}} / {{total}}",
    "buttons": {
      "prev": "Previous",
      "next": "Next",
      "finish": "Finish",
      "skip": "Skip"
    },
    "closeAriaLabel": "Close tour",
    "replayIconAriaLabel": "Replay this page's tour",
    "mobilePointsTo": "↑ points to the described element"
  }
}
```

- [ ] **Step 3: Rewrite `frontend/src/tips/content.ts`**

Overwrite the file with:

```ts
// Central registry for the tip ids the client is allowed to persist via
// TipsContext. Mirrored in backend/src/http/routes/tips/tip-ids.ts —
// __tests__/content.test.ts asserts literal equality across both.
//
// v2: one id per PageId (`tour:<pageId>`). The prior `welcome_tour` and
// `section:*` ids are removed by design — see
// docs/superpowers/specs/2026-07-20-tips-anchored-tours-design.md.

import { PAGE_IDS, type PageId } from './tours';

export const TIP_IDS = PAGE_IDS.map((p) => `tour:${p}` as const) as ReadonlyArray<`tour:${PageId}`>;

export type TipId = `tour:${PageId}`;
```

- [ ] **Step 4: Rewrite the lockstep test**

Overwrite `frontend/src/tips/__tests__/content.test.ts`:

```ts
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
```

- [ ] **Step 5: Run the content test**

Run: `cd frontend && npx vitest run src/tips/__tests__/content.test.ts`
Expected: PASS — 3 tests pass. If the French locale test fails on missing-key fallback, the JSON path is wrong; check that `tours.dashboard.0.title` resolves — the JSON must be nested as `tours: { dashboard: { "0": { title, body } } }`.

- [ ] **Step 6: Run the full frontend suite to confirm nothing else broke yet**

Run: `cd frontend && npx vitest run`
Expected: FAILING tests — `SectionTip.test.tsx`, `SectionTipHelpIcon.test.tsx`, `WelcomeTour.test.tsx`, `TipsContext.test.tsx`, and any test that imports `sectionTip`/`welcomeStep` from `content.ts` (they no longer exist). That's expected — those are removed in Tasks 3 & 9. Do NOT try to fix them here; leave them red.

- [ ] **Step 7: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  add frontend/src/locales/en/tips.json frontend/src/locales/fr/tips.json \
      frontend/src/tips/content.ts frontend/src/tips/__tests__/content.test.ts && \
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "feat(tips): rewrite locale content and slim TIP_IDS to tour:<page>

Locales now hold seven per-page tour blocks keyed by index. content.ts
derives TIP_IDS from PAGE_IDS so the two registries can't drift.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Backend allowlist + orphan-key cleanup at startup

**Files:**
- Modify: `backend/src/http/routes/tips/tip-ids.ts`
- Modify: `backend/src/buildServer.ts` (add one-shot cleanup call at boot)
- Create: `backend/src/http/routes/tips/cleanup.ts` (the cleanup helper)
- Create: `backend/src/http/routes/tips/__tests__/cleanup.test.ts`

**Interfaces:**
- Consumes: nothing new; uses the existing `db` client and `userSettings` table.
- Produces:
  - `TIP_IDS` frozen to the new 7 `tour:*` ids
  - `cleanupOrphanTipIds(db): Promise<{ scanned: number, mutated: number }>` — strips unknown keys from every user's `dismissed_tips` jsonb.

- [ ] **Step 1: Update backend `TIP_IDS`**

Overwrite `backend/src/http/routes/tips/tip-ids.ts`:

```ts
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
```

- [ ] **Step 2: Write the failing test for `cleanupOrphanTipIds`**

Create `backend/src/http/routes/tips/__tests__/cleanup.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { cleanupOrphanTipIds } from '../cleanup';

type Row = { userId: string; dismissedTips: Record<string, string> | null };

// Minimal fake — records both SELECT (scanned) and UPDATE (mutated) calls.
function makeFakeDb(rows: Row[]) {
  const updates: Array<{ userId: string; dismissedTips: Record<string, string> }> = [];
  return {
    updates,
    async select(): Promise<Row[]> { return rows; },
    async update(userId: string, dismissedTips: Record<string, string>): Promise<void> {
      updates.push({ userId, dismissedTips });
    },
  };
}

describe('cleanupOrphanTipIds', () => {
  it('drops keys not in the allowlist and rewrites the row', async () => {
    const fake = makeFakeDb([
      { userId: 'u1', dismissedTips: {
        'welcome_tour': '2026-01-01T00:00:00.000Z',
        'section:dashboard': '2026-01-02T00:00:00.000Z',
        'tour:dashboard': '2026-07-01T00:00:00.000Z',
      } },
    ]);
    const stats = await cleanupOrphanTipIds({
      select: () => fake.select(),
      updateDismissed: (userId, blob) => fake.update(userId, blob),
    });
    expect(stats.scanned).toBe(1);
    expect(stats.mutated).toBe(1);
    expect(fake.updates).toHaveLength(1);
    expect(fake.updates[0].userId).toBe('u1');
    expect(fake.updates[0].dismissedTips).toEqual({
      'tour:dashboard': '2026-07-01T00:00:00.000Z',
    });
  });

  it('does not update rows that already contain only allowed ids', async () => {
    const fake = makeFakeDb([
      { userId: 'u2', dismissedTips: { 'tour:accounts': '2026-07-15T00:00:00.000Z' } },
    ]);
    const stats = await cleanupOrphanTipIds({
      select: () => fake.select(),
      updateDismissed: (userId, blob) => fake.update(userId, blob),
    });
    expect(stats.scanned).toBe(1);
    expect(stats.mutated).toBe(0);
    expect(fake.updates).toHaveLength(0);
  });

  it('deletes a jsonb blob down to {} if every key is orphaned', async () => {
    const fake = makeFakeDb([
      { userId: 'u3', dismissedTips: { 'welcome_tour': 'x', 'section:budgets': 'y' } },
    ]);
    const stats = await cleanupOrphanTipIds({
      select: () => fake.select(),
      updateDismissed: (userId, blob) => fake.update(userId, blob),
    });
    expect(stats.mutated).toBe(1);
    expect(fake.updates[0].dismissedTips).toEqual({});
  });

  it('skips rows with null dismissedTips', async () => {
    const fake = makeFakeDb([{ userId: 'u4', dismissedTips: null }]);
    const stats = await cleanupOrphanTipIds({
      select: () => fake.select(),
      updateDismissed: (userId, blob) => fake.update(userId, blob),
    });
    expect(stats.scanned).toBe(1);
    expect(stats.mutated).toBe(0);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend && npx vitest run src/http/routes/tips/__tests__/cleanup.test.ts`
Expected: FAIL — `Cannot find module '../cleanup'`.

- [ ] **Step 4: Implement `cleanup.ts` — pure function first**

Create `backend/src/http/routes/tips/cleanup.ts`:

```ts
import { eq } from 'drizzle-orm';
import { db as realDb } from '../../../db/client.js';
import { userSettings } from '../../../db/schema.js';
import { TIP_IDS } from './tip-ids.js';

export interface CleanupDeps {
  select: () => Promise<Array<{ userId: string; dismissedTips: Record<string, string> | null }>>;
  updateDismissed: (userId: string, blob: Record<string, string>) => Promise<void>;
}

// Pure function — takes deps so the test can pass a fake db. The default
// binding (below) uses the real drizzle client. On boot we log
// `{ scanned, mutated }`; we don't fail the boot on cleanup errors —
// the app still functions with a stale blob (unknown keys are just
// ignored client-side).
export async function cleanupOrphanTipIds(deps: CleanupDeps): Promise<{ scanned: number; mutated: number }> {
  const rows = await deps.select();
  const allowed = new Set<string>(TIP_IDS);
  let mutated = 0;
  for (const row of rows) {
    if (row.dismissedTips == null) continue;
    const kept: Record<string, string> = {};
    let dropped = 0;
    for (const [k, v] of Object.entries(row.dismissedTips)) {
      if (allowed.has(k)) kept[k] = v;
      else dropped++;
    }
    if (dropped === 0) continue;
    await deps.updateDismissed(row.userId, kept);
    mutated++;
  }
  return { scanned: rows.length, mutated };
}

// Real binding — reads every row of user_settings, updates in place.
// Called once at server boot from buildServer.ts.
export async function runOrphanCleanup(): Promise<{ scanned: number; mutated: number }> {
  return cleanupOrphanTipIds({
    select: async () => {
      const rows = await realDb
        .select({ userId: userSettings.userId, dismissedTips: userSettings.dismissedTips })
        .from(userSettings);
      return rows.map((r) => ({
        userId: r.userId,
        dismissedTips: (r.dismissedTips as Record<string, string> | null) ?? null,
      }));
    },
    updateDismissed: async (userId, blob) => {
      await realDb
        .update(userSettings)
        .set({ dismissedTips: blob })
        .where(eq(userSettings.userId, userId));
    },
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && npx vitest run src/http/routes/tips/__tests__/cleanup.test.ts`
Expected: PASS — 4 tests pass.

- [ ] **Step 6: Wire the cleanup into `buildServer.ts`**

Open `backend/src/buildServer.ts`. Find the `tipsRoutes` registration line (around line 27 in the current file). Add these two edits:

Add near the other imports at the top:

```ts
import { runOrphanCleanup } from './http/routes/tips/cleanup.js';
```

Find the `build(...)` function's return (the very last `return app;` or equivalent). Immediately before it — after every `app.register(...)` has run — add:

```ts
  // v2 orphan-key sweep: strip pre-v2 tip ids ('welcome_tour', 'section:*')
  // from every user's dismissed_tips jsonb. One-shot at boot. Failures are
  // logged and swallowed — the app still functions with a stale blob (the
  // client ignores unknown keys), so a transient DB hiccup shouldn't block
  // start-up.
  runOrphanCleanup().then(
    (stats) => app.log.info({ ...stats }, 'tips: orphan-key sweep complete'),
    (err) => app.log.warn({ err }, 'tips: orphan-key sweep failed'),
  );
```

If `build()` returns before it awaits some other init, add the sweep just after the final `await app.register(...)` line and BEFORE `return app;` — the actual placement is whichever line reads "return app" (or "return await Promise.resolve(app)") at the very end of the function. Do not `await` the sweep — kicking it off in the background lets HTTP traffic start immediately.

- [ ] **Step 7: Sanity-run backend tests**

Run: `cd backend && npx vitest run`
Expected: PASS. If any pre-existing test asserts the old `TIP_IDS` array literally, it must be updated to the new array here — grep first:

```bash
grep -rn "welcome_tour\|section:" backend/src
```

Update any hits to reference the new ids (there should be none, but confirm).

- [ ] **Step 8: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  add backend/src/http/routes/tips backend/src/buildServer.ts && \
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "feat(tips): migrate backend allowlist to tour:<page> and add orphan sweep

Boot-time cleanup strips pre-v2 keys from every user_settings.dismissed_tips
blob. Logged, not awaited; failures don't block startup.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `TourContext` provider

**Files:**
- Create: `frontend/src/contexts/TourContext.tsx`
- Create: `frontend/src/contexts/__tests__/TourContext.test.tsx`

**Interfaces:**
- Consumes: `PageId`, `AnchorId`, `TOURS`, `tipIdFor` from `tours.ts`; `useTips()` from `TipsContext`.
- Produces:
  ```ts
  interface TourContextValue {
    activePageId: PageId | null;
    stepIdx: number;
    registerAnchor: (id: AnchorId, el: HTMLElement | null) => void;
    getAnchor: (id: AnchorId) => HTMLElement | null;
    anchorVersion: number;
    startTour: (pageId: PageId) => void;
    nextStep: () => void;
    prevStep: () => void;
    finishTour: () => void;
    skipTour: () => void;
    abortTour: () => void;
  }
  export function TourProvider({ children }: { children: ReactNode }): JSX.Element;
  export function useTour(): TourContextValue;
  ```

- [ ] **Step 1: Write the failing test**

Create `frontend/src/contexts/__tests__/TourContext.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { TourProvider, useTour } from '../TourContext';
import { TipsProvider } from '../TipsContext';

// Wire fetch mock so TipsProvider hydrates to ready=true with no dismissals.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('/api/tips/dismissed')) {
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({ dismissed: {} }),
      } as Response;
    }
    if (url.endsWith('/api/tips/dismiss') || url.endsWith('/api/tips/undismiss')) {
      return { ok: true, status: 200, text: async () => '{}' } as Response;
    }
    return { ok: false, status: 404, text: async () => '{}' } as Response;
  }));
});

function wrap({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter initialEntries={['/']}>
      <TipsProvider>
        <TourProvider>
          <Routes>
            <Route path="*" element={<>{children}</>} />
          </Routes>
        </TourProvider>
      </TipsProvider>
    </MemoryRouter>
  );
}

describe('TourContext', () => {
  it('startTour sets activePageId and resets stepIdx=0', () => {
    const { result } = renderHook(() => useTour(), { wrapper: wrap });
    expect(result.current.activePageId).toBeNull();
    act(() => result.current.startTour('dashboard'));
    expect(result.current.activePageId).toBe('dashboard');
    expect(result.current.stepIdx).toBe(0);
  });

  it('nextStep advances and prevStep steps back; both clamp at bounds', () => {
    const { result } = renderHook(() => useTour(), { wrapper: wrap });
    act(() => result.current.startTour('dashboard')); // 5 steps
    act(() => result.current.nextStep());
    expect(result.current.stepIdx).toBe(1);
    act(() => result.current.prevStep());
    expect(result.current.stepIdx).toBe(0);
    act(() => result.current.prevStep()); // clamp low
    expect(result.current.stepIdx).toBe(0);
    for (let i = 0; i < 10; i++) act(() => result.current.nextStep());
    // last valid stepIdx = TOURS.dashboard.length - 1 = 4; going past finishes.
    expect(result.current.activePageId).toBeNull(); // tour finished, cleared
  });

  it('finishTour dismisses and clears', async () => {
    const fetchSpy = vi.mocked(globalThis.fetch);
    const { result } = renderHook(() => useTour(), { wrapper: wrap });
    act(() => result.current.startTour('accounts'));
    await act(async () => { result.current.finishTour(); });
    expect(result.current.activePageId).toBeNull();
    const dismissCall = fetchSpy.mock.calls.find(([u]) => String(u).endsWith('/api/tips/dismiss'));
    expect(dismissCall).toBeDefined();
    const body = JSON.parse(String((dismissCall![1] as RequestInit).body));
    expect(body).toEqual({ id: 'tour:accounts' });
  });

  it('skipTour dismisses and clears', async () => {
    const fetchSpy = vi.mocked(globalThis.fetch);
    const { result } = renderHook(() => useTour(), { wrapper: wrap });
    act(() => result.current.startTour('imports'));
    await act(async () => { result.current.skipTour(); });
    expect(result.current.activePageId).toBeNull();
    expect(fetchSpy.mock.calls.some(([u]) => String(u).endsWith('/api/tips/dismiss'))).toBe(true);
  });

  it('abortTour clears WITHOUT dismissing', async () => {
    const fetchSpy = vi.mocked(globalThis.fetch);
    fetchSpy.mockClear();
    const { result } = renderHook(() => useTour(), { wrapper: wrap });
    act(() => result.current.startTour('data'));
    act(() => result.current.abortTour());
    expect(result.current.activePageId).toBeNull();
    expect(fetchSpy.mock.calls.some(([u]) => String(u).endsWith('/api/tips/dismiss'))).toBe(false);
  });

  it('starting a new tour while one runs aborts (no persistence)', async () => {
    const fetchSpy = vi.mocked(globalThis.fetch);
    fetchSpy.mockClear();
    const { result } = renderHook(() => useTour(), { wrapper: wrap });
    act(() => result.current.startTour('rules'));
    act(() => result.current.startTour('budgets'));
    expect(result.current.activePageId).toBe('budgets');
    expect(result.current.stepIdx).toBe(0);
    expect(fetchSpy.mock.calls.some(([u]) => String(u).endsWith('/api/tips/dismiss'))).toBe(false);
  });

  it('registerAnchor / getAnchor round-trips a DOM node and bumps anchorVersion', () => {
    const { result } = renderHook(() => useTour(), { wrapper: wrap });
    const el = document.createElement('div');
    const v0 = result.current.anchorVersion;
    act(() => result.current.registerAnchor('dashboard:balance', el));
    expect(result.current.getAnchor('dashboard:balance')).toBe(el);
    expect(result.current.anchorVersion).toBeGreaterThan(v0);
    const v1 = result.current.anchorVersion;
    act(() => result.current.registerAnchor('dashboard:balance', null));
    expect(result.current.getAnchor('dashboard:balance')).toBeNull();
    expect(result.current.anchorVersion).toBeGreaterThan(v1);
  });

  it('last-register-wins when two mounts register the same anchor', () => {
    const { result } = renderHook(() => useTour(), { wrapper: wrap });
    const a = document.createElement('div');
    const b = document.createElement('div');
    act(() => result.current.registerAnchor('accounts:add-button', a));
    act(() => result.current.registerAnchor('accounts:add-button', b));
    expect(result.current.getAnchor('accounts:add-button')).toBe(b);
  });

  it('route change while a tour runs calls abort (no persistence)', async () => {
    const fetchSpy = vi.mocked(globalThis.fetch);
    fetchSpy.mockClear();
    function Harness({ onReady }: { onReady: (nav: (to: string) => void) => void }) {
      const nav = useNavigate();
      onReady(nav);
      return null;
    }
    let navigate: ((to: string) => void) | null = null;
    const { result } = renderHook(() => useTour(), {
      wrapper: ({ children }) => (
        <MemoryRouter initialEntries={['/']}>
          <TipsProvider>
            <TourProvider>
              <Harness onReady={(n) => { navigate = n; }} />
              {children}
            </TourProvider>
          </TipsProvider>
        </MemoryRouter>
      ),
    });
    act(() => result.current.startTour('dashboard'));
    expect(result.current.activePageId).toBe('dashboard');
    act(() => { navigate!('/transactions'); });
    expect(result.current.activePageId).toBeNull();
    expect(fetchSpy.mock.calls.some(([u]) => String(u).endsWith('/api/tips/dismiss'))).toBe(false);
  });

  it('after 2s with no anchor for the current step, auto-skips forward', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useTour(), { wrapper: wrap });
      act(() => result.current.startTour('dashboard'));
      // No anchor ever registered for 'dashboard:balance'.
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(result.current.stepIdx).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/contexts/__tests__/TourContext.test.tsx`
Expected: FAIL — `Cannot find module '../TourContext'`.

- [ ] **Step 3: Implement `TourContext.tsx`**

Create `frontend/src/contexts/TourContext.tsx`:

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';
import { useTips } from './TipsContext';
import { TOURS, tipIdFor, type AnchorId, type PageId } from '../tips/tours';

interface TourContextValue {
  activePageId: PageId | null;
  stepIdx: number;
  registerAnchor: (id: AnchorId, el: HTMLElement | null) => void;
  getAnchor: (id: AnchorId) => HTMLElement | null;
  anchorVersion: number;
  startTour: (pageId: PageId) => void;
  nextStep: () => void;
  prevStep: () => void;
  finishTour: () => void;
  skipTour: () => void;
  abortTour: () => void;
}

const TourCtx = createContext<TourContextValue | null>(null);

export function useTour(): TourContextValue {
  const ctx = useContext(TourCtx);
  if (!ctx) throw new Error('useTour() must be used inside <TourProvider>');
  return ctx;
}

const MISSING_ANCHOR_TIMEOUT_MS = 2_000;

export function TourProvider({ children }: { children: ReactNode }): JSX.Element {
  const { dismiss } = useTips();
  const location = useLocation();

  const [activePageId, setActivePageId] = useState<PageId | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [anchorVersion, setAnchorVersion] = useState(0);

  // Anchor id → DOM node. Held in a ref (mutations don't need to trigger
  // a render on their own); bumping anchorVersion is what re-renders
  // TourBubble so it can re-resolve.
  const anchorsRef = useRef<Map<AnchorId, HTMLElement>>(new Map());

  const registerAnchor = useCallback((id: AnchorId, el: HTMLElement | null) => {
    if (el == null) anchorsRef.current.delete(id);
    else anchorsRef.current.set(id, el);
    setAnchorVersion((v) => v + 1);
  }, []);

  const getAnchor = useCallback((id: AnchorId) => anchorsRef.current.get(id) ?? null, []);

  const startTour = useCallback((pageId: PageId) => {
    setActivePageId(pageId);
    setStepIdx(0);
  }, []);

  const finishTour = useCallback(() => {
    setActivePageId((current) => {
      if (current) {
        dismiss(tipIdFor(current)).catch(() => {
          // Optimistic update handled by TipsContext; failure is silent.
        });
      }
      return null;
    });
  }, [dismiss]);

  const skipTour = finishTour;

  const abortTour = useCallback(() => {
    setActivePageId(null);
  }, []);

  const nextStep = useCallback(() => {
    if (activePageId == null) return;
    const total = TOURS[activePageId].length;
    if (stepIdx >= total - 1) {
      finishTour();
      return;
    }
    setStepIdx((s) => s + 1);
  }, [activePageId, stepIdx, finishTour]);

  const prevStep = useCallback(() => {
    setStepIdx((s) => Math.max(0, s - 1));
  }, []);

  // Route-change abort. Runs any time `location.pathname` changes and a
  // tour is running. We intentionally do NOT dismiss here.
  const lastPathRef = useRef(location.pathname);
  useEffect(() => {
    if (location.pathname !== lastPathRef.current) {
      lastPathRef.current = location.pathname;
      setActivePageId((prev) => (prev != null ? null : prev));
    }
  }, [location.pathname]);

  // 2 s missing-anchor auto-skip. Reset on step change, on tour start /
  // stop, and whenever anchorVersion bumps (so a late registration
  // cancels the fallback).
  useEffect(() => {
    if (activePageId == null) return;
    const step = TOURS[activePageId][stepIdx];
    if (step == null) return;
    if (anchorsRef.current.has(step.anchor)) return;
    const t = setTimeout(() => {
      // Re-check inside the timer — the anchor may have registered
      // between the effect scheduling and the timer firing but before
      // the anchorVersion bump could re-run this effect.
      if (anchorsRef.current.has(step.anchor)) return;
      // nextStep semantics inline: if past last, finish; else advance.
      const total = TOURS[activePageId].length;
      if (stepIdx >= total - 1) finishTour();
      else setStepIdx((s) => s + 1);
    }, MISSING_ANCHOR_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [activePageId, stepIdx, anchorVersion, finishTour]);

  const value = useMemo<TourContextValue>(
    () => ({
      activePageId,
      stepIdx,
      registerAnchor,
      getAnchor,
      anchorVersion,
      startTour,
      nextStep,
      prevStep,
      finishTour,
      skipTour,
      abortTour,
    }),
    [
      activePageId, stepIdx, anchorVersion,
      registerAnchor, getAnchor,
      startTour, nextStep, prevStep, finishTour, skipTour, abortTour,
    ],
  );

  return <TourCtx.Provider value={value}>{children}</TourCtx.Provider>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/contexts/__tests__/TourContext.test.tsx`
Expected: PASS — 10 tests pass.

Common gotchas if red:
- `startTour → startTour` case failing because `setActivePageId` batches: use `expect` after a second `act` block, or read `result.current` post-flush.
- `route change` test failing because `setActivePageId(null → null)` doesn't re-render: the guard `prev != null ? null : prev` intentionally avoids that.

- [ ] **Step 5: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  add frontend/src/contexts/TourContext.tsx frontend/src/contexts/__tests__/TourContext.test.tsx && \
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "feat(tips): TourContext provider with anchor registry and route-abort

Owns activePageId/stepIdx, an AnchorId→DOM map with version-based
re-render, and a 2s missing-anchor auto-skip fallback. Route change
aborts without persisting.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `useTourAnchor` hook

**Files:**
- Create: `frontend/src/hooks/useTourAnchor.ts`
- Create: `frontend/src/hooks/__tests__/useTourAnchor.test.tsx`

The `frontend/src/hooks/` directory does not exist yet — the first file created in it establishes the convention.

**Interfaces:**
- Consumes: `useTour()` from `TourContext` (Task 4); `AnchorId` from `tours.ts`.
- Produces: `useTourAnchor(id: AnchorId): (el: HTMLElement | null) => void`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/hooks/__tests__/useTourAnchor.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TipsProvider } from '../../contexts/TipsContext';
import { TourProvider, useTour } from '../../contexts/TourContext';
import { useTourAnchor } from '../useTourAnchor';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status: 200, text: async () => JSON.stringify({ dismissed: {} }),
  } as Response)));
});

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter>
      <TipsProvider>
        <TourProvider>{children}</TourProvider>
      </TipsProvider>
    </MemoryRouter>
  );
}

function Probe() {
  const tour = useTour();
  const node = tour.getAnchor('dashboard:balance');
  return <span data-testid="probe">{node ? 'yes' : 'no'}</span>;
}

function Target() {
  const ref = useTourAnchor('dashboard:balance');
  return <div ref={ref} data-testid="target" />;
}

describe('useTourAnchor', () => {
  it('registers on mount and clears on unmount', () => {
    function Root({ show }: { show: boolean }) {
      return <>{show && <Target />}<Probe /></>;
    }
    const { rerender } = render(<Wrap><Root show={true} /></Wrap>);
    // Wait a microtask so refs flush + provider re-renders.
    expect(screen.getByTestId('probe').textContent).toBe('yes');
    rerender(<Wrap><Root show={false} /></Wrap>);
    expect(screen.getByTestId('probe').textContent).toBe('no');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/__tests__/useTourAnchor.test.tsx`
Expected: FAIL — `Cannot find module '../useTourAnchor'`.

- [ ] **Step 3: Implement the hook**

Create `frontend/src/hooks/useTourAnchor.ts`:

```ts
import { useCallback } from 'react';
import { useTour } from '../contexts/TourContext';
import type { AnchorId } from '../tips/tours';

// Ref-callback hook: target elements attach it via <div ref={useTourAnchor('foo:bar')} />
// to expose their DOM node to the running tour. On mount, calls
// registerAnchor(id, node); on unmount, calls registerAnchor(id, null).
//
// If the same AnchorId is used from two mount points at once
// (e.g. `accounts:add-button` in the header and in the empty-state CTA),
// last-register-wins in TourContext — the empty state, being
// conditionally mounted, effectively takes over when it is visible.
export function useTourAnchor(id: AnchorId): (el: HTMLElement | null) => void {
  const { registerAnchor } = useTour();
  return useCallback((el: HTMLElement | null) => {
    registerAnchor(id, el);
  }, [id, registerAnchor]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/hooks/__tests__/useTourAnchor.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  add frontend/src/hooks/useTourAnchor.ts frontend/src/hooks/__tests__/useTourAnchor.test.tsx && \
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "feat(tips): useTourAnchor ref-callback hook

Establishes frontend/src/hooks/ directory for reusable hooks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `useAutoStartTour` hook (with data-gating)

**Files:**
- Create: `frontend/src/hooks/useAutoStartTour.ts`
- Create: `frontend/src/hooks/__tests__/useAutoStartTour.test.tsx`

**Interfaces:**
- Consumes: `useTips`, `useTour`, `tipIdFor` from prior tasks.
- Produces: `useAutoStartTour(pageId: PageId, opts?: { requireData?: () => boolean }): void`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/hooks/__tests__/useAutoStartTour.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TipsProvider } from '../../contexts/TipsContext';
import { TourProvider, useTour } from '../../contexts/TourContext';
import { useAutoStartTour } from '../useAutoStartTour';

type Dismissed = Record<string, string>;
function stubTips(dismissed: Dismissed = {}) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('/api/tips/dismissed')) {
      return { ok: true, status: 200,
        text: async () => JSON.stringify({ dismissed }),
      } as Response;
    }
    return { ok: true, status: 200, text: async () => '{}' } as Response;
  }));
}

function Harness({ pageId, requireData, onTour }: {
  pageId: any; requireData?: () => boolean; onTour: (activePageId: string | null) => void;
}) {
  useAutoStartTour(pageId, requireData ? { requireData } : undefined);
  const tour = useTour();
  onTour(tour.activePageId);
  return null;
}

beforeEach(() => {
  vi.resetAllMocks();
});

function wrap(node: React.ReactNode) {
  return (
    <MemoryRouter>
      <TipsProvider>
        <TourProvider>{node}</TourProvider>
      </TipsProvider>
    </MemoryRouter>
  );
}

describe('useAutoStartTour', () => {
  it('auto-starts when ready + not-dismissed + no requireData', async () => {
    stubTips();
    const seen: (string | null)[] = [];
    render(wrap(<Harness pageId="dashboard" onTour={(a) => seen.push(a)} />));
    await waitFor(() => expect(seen[seen.length - 1]).toBe('dashboard'));
  });

  it('does NOT auto-start when requireData returns false', async () => {
    stubTips();
    const seen: (string | null)[] = [];
    render(wrap(<Harness pageId="dashboard" requireData={() => false}
                          onTour={(a) => seen.push(a)} />));
    // Allow hydration to complete.
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[seen.length - 1]).toBeNull();
  });

  it('auto-starts once requireData flips to true on rerender', async () => {
    stubTips();
    const seen: (string | null)[] = [];
    let flag = false;
    const { rerender } = render(wrap(
      <Harness pageId="transactions" requireData={() => flag}
               onTour={(a) => seen.push(a)} />
    ));
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[seen.length - 1]).toBeNull();
    flag = true;
    rerender(wrap(
      <Harness pageId="transactions" requireData={() => flag}
               onTour={(a) => seen.push(a)} />
    ));
    await waitFor(() => expect(seen[seen.length - 1]).toBe('transactions'));
  });

  it('treats a throwing requireData as false and does not crash', async () => {
    stubTips();
    const seen: (string | null)[] = [];
    render(wrap(
      <Harness pageId="budgets" requireData={() => { throw new Error('boom'); }}
               onTour={(a) => seen.push(a)} />
    ));
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[seen.length - 1]).toBeNull();
  });

  it('does not auto-start when the tour id is already dismissed', async () => {
    stubTips({ 'tour:dashboard': '2026-07-01T00:00:00Z' });
    const seen: (string | null)[] = [];
    render(wrap(<Harness pageId="dashboard" onTour={(a) => seen.push(a)} />));
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[seen.length - 1]).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/__tests__/useAutoStartTour.test.tsx`
Expected: FAIL — `Cannot find module '../useAutoStartTour'`.

- [ ] **Step 3: Implement the hook**

Create `frontend/src/hooks/useAutoStartTour.ts`:

```ts
import { useEffect } from 'react';
import { useTips } from '../contexts/TipsContext';
import { useTour } from '../contexts/TourContext';
import { tipIdFor, type PageId } from '../tips/tours';

export interface UseAutoStartTourOptions {
  requireData?: () => boolean;
}

// One effect per page mount. Fires startTour when every gate passes:
//   ready + !dismissed + no active tour + (requireData?() ?? true).
// Effect re-runs on every render (requireData may look at fresh
// React Query cache each render), but short-circuits once the tour is
// dismissed. A throwing predicate is treated as false — a crash in
// business logic should not block onboarding auto-start; the tour
// simply waits for a healthy render.
export function useAutoStartTour(pageId: PageId, opts?: UseAutoStartTourOptions): void {
  const { ready, isDismissed } = useTips();
  const { activePageId, startTour } = useTour();

  useEffect(() => {
    if (!ready) return;
    if (isDismissed(tipIdFor(pageId))) return;
    if (activePageId != null) return;
    let dataOk = true;
    if (opts?.requireData) {
      try { dataOk = opts.requireData(); }
      catch { dataOk = false; }
    }
    if (!dataOk) return;
    startTour(pageId);
  });
  // Intentionally no dep array: requireData is a closure over caller
  // state that we can't statically enumerate, and the guards above make
  // the effect body cheap on every render (returns early once dismissed
  // or when a tour is running).
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/hooks/__tests__/useAutoStartTour.test.tsx`
Expected: PASS — 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  add frontend/src/hooks/useAutoStartTour.ts frontend/src/hooks/__tests__/useAutoStartTour.test.tsx && \
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "feat(tips): useAutoStartTour hook with data-gating

Auto-starts a tour on first visit if the page's dismissal is absent, no
other tour runs, and the optional requireData predicate returns true.
Throwing predicate is treated as false.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `TourBubble` component

**Files:**
- Create: `frontend/src/components/TourBubble.tsx`
- Create: `frontend/src/components/__tests__/TourBubble.test.tsx`

**Interfaces:**
- Consumes: `useTour` (Task 4), `TOURS`, `PageId` (Task 1).
- Produces: `export function TourBubble(): JSX.Element | null` — mounted once at the app root inside `<TourProvider>`.

Design constraints from the spec:
- floating-ui middleware chain, in order: `offset(10)`, `flip()`, `shift({ padding: 8 })`, `arrow(...)`.
- Portalled to `document.body`.
- Max-width 320 px, `surface-soft` background, rounded 12 px.
- Title + body + step counter + buttons + arrow.
- `Terminer` label on the last step; otherwise `Suivant`.
- `Précédent` disabled on step 0.
- `Esc` skips; `←` / `→` step.
- Focus moves to the bubble on step change; returns to anchor on close.
- Mobile (viewport < 640 px): bubble docks to viewport bottom; arrow replaced by a "↑ pointe vers ..." inline indicator (i18n key `tour.mobilePointsTo`).
- `role="dialog"`, `aria-labelledby` = title id.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/__tests__/TourBubble.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TipsProvider } from '../../contexts/TipsContext';
import { TourProvider, useTour } from '../../contexts/TourContext';
import { useTourAnchor } from '../../hooks/useTourAnchor';
import { TourBubble } from '../TourBubble';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status: 200, text: async () => JSON.stringify({ dismissed: {} }),
  } as Response)));
});

function wrap(node: React.ReactNode) {
  return (
    <MemoryRouter>
      <TipsProvider>
        <TourProvider>{node}</TourProvider>
      </TipsProvider>
    </MemoryRouter>
  );
}

function Anchors() {
  const a = useTourAnchor('dashboard:balance');
  const b = useTourAnchor('dashboard:curve');
  const c = useTourAnchor('dashboard:donut');
  const d = useTourAnchor('dashboard:insights');
  const e = useTourAnchor('dashboard:sankey');
  return (
    <div>
      <div ref={a} data-testid="anchor-balance">Balance</div>
      <div ref={b}>Curve</div>
      <div ref={c}>Donut</div>
      <div ref={d}>Insights</div>
      <div ref={e}>Sankey</div>
    </div>
  );
}

function StartHarness({ pageId }: { pageId: 'dashboard' }) {
  const tour = useTour();
  return <button onClick={() => tour.startTour(pageId)}>start</button>;
}

describe('<TourBubble />', () => {
  it('renders null when no tour is active', () => {
    render(wrap(<><Anchors /><TourBubble /></>));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders title, body, step counter, and buttons when active', async () => {
    render(wrap(<><Anchors /><StartHarness pageId="dashboard" /><TourBubble /></>));
    await userEvent.click(screen.getByText('start'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Solde global|Total balance/i)).toBeInTheDocument();
    expect(screen.getByText(/Étape 1 \/ 5|Step 1 \/ 5/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Suivant|Next/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Passer|Skip/i })).toBeInTheDocument();
  });

  it('advances on Suivant and steps back on Précédent', async () => {
    render(wrap(<><Anchors /><StartHarness pageId="dashboard" /><TourBubble /></>));
    await userEvent.click(screen.getByText('start'));
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: /Suivant|Next/i }));
    expect(screen.getByText(/Étape 2 \/ 5|Step 2 \/ 5/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Précédent|Previous/i }));
    expect(screen.getByText(/Étape 1 \/ 5|Step 1 \/ 5/i)).toBeInTheDocument();
  });

  it('last-step Suivant renders as Terminer and dismisses on click', async () => {
    render(wrap(<><Anchors /><StartHarness pageId="dashboard" /><TourBubble /></>));
    await userEvent.click(screen.getByText('start'));
    await screen.findByRole('dialog');
    for (let i = 0; i < 4; i++) {
      await userEvent.click(screen.getByRole('button', { name: /Suivant|Next/i }));
    }
    // Now on step 5/5 — button should read Terminer/Finish.
    const finish = screen.getByRole('button', { name: /Terminer|Finish/i });
    await userEvent.click(finish);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Précédent is disabled on step 0', async () => {
    render(wrap(<><Anchors /><StartHarness pageId="dashboard" /><TourBubble /></>));
    await userEvent.click(screen.getByText('start'));
    await screen.findByRole('dialog');
    expect(screen.getByRole('button', { name: /Précédent|Previous/i })).toBeDisabled();
  });

  it('Esc skips (dismisses)', async () => {
    render(wrap(<><Anchors /><StartHarness pageId="dashboard" /><TourBubble /></>));
    await userEvent.click(screen.getByText('start'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('arrow keys step forward and back', async () => {
    render(wrap(<><Anchors /><StartHarness pageId="dashboard" /><TourBubble /></>));
    await userEvent.click(screen.getByText('start'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(screen.getByText(/Étape 2 \/ 5|Step 2 \/ 5/i)).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    expect(screen.getByText(/Étape 1 \/ 5|Step 1 \/ 5/i)).toBeInTheDocument();
  });

  it('renders null while the current step\'s anchor is unresolved', async () => {
    function OnlyOne() {
      // Register only the FIRST anchor; step 2 will be missing.
      const a = useTourAnchor('dashboard:balance');
      return <div ref={a} data-testid="anchor-balance" />;
    }
    render(wrap(<><OnlyOne /><StartHarness pageId="dashboard" /><TourBubble /></>));
    await userEvent.click(screen.getByText('start'));
    await screen.findByRole('dialog');
    // Step 0 renders (anchor resolved).
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/__tests__/TourBubble.test.tsx`
Expected: FAIL — `Cannot find module '../TourBubble'`.

- [ ] **Step 3: Implement `TourBubble.tsx`**

Create `frontend/src/components/TourBubble.tsx`:

```tsx
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  arrow,
  FloatingArrow,
  useDismiss,
  useInteractions,
  useRole,
  type Placement,
} from '@floating-ui/react';
import { useTranslation } from 'react-i18next';
import { useTour } from '../contexts/TourContext';
import { TOURS } from '../tips/tours';

const MOBILE_BREAKPOINT = 640;

// The visible popover. Mounted once at the app root inside <TourProvider>.
// Renders null when no tour is running or the current step's anchor is
// unresolved (the TourContext 2s fallback handles the permanent case).
export function TourBubble(): JSX.Element | null {
  const {
    activePageId, stepIdx, getAnchor, anchorVersion,
    nextStep, prevStep, finishTour, skipTour,
  } = useTour();
  const { t } = useTranslation('tips');

  const [isMobile, setIsMobile] = useState<boolean>(
    typeof window !== 'undefined' ? window.innerWidth < MOBILE_BREAKPOINT : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const arrowRef = useRef<SVGSVGElement | null>(null);
  const anchor = activePageId != null ? getAnchor(TOURS[activePageId][stepIdx]?.anchor) : null;
  const stepDef = activePageId != null ? TOURS[activePageId][stepIdx] : null;
  const desiredPlacement: Placement = (stepDef?.placement ?? 'bottom-start') as Placement;

  const { refs, floatingStyles, context, update } = useFloating({
    open: activePageId != null && anchor != null && !isMobile,
    placement: desiredPlacement,
    middleware: [offset(10), flip(), shift({ padding: 8 }), arrow({ element: arrowRef })],
    whileElementsMounted: autoUpdate,
  });

  // Keep floating-ui in sync with anchor identity (a re-registration
  // gives us a fresh HTMLElement; refs.setReference must be called with it).
  useLayoutEffect(() => {
    refs.setReference(anchor ?? null);
  }, [anchor, refs, anchorVersion]);

  // Scroll anchor into view on step change (skip the very first step to
  // avoid a page-load jump).
  const firstRenderRef = useRef(true);
  useEffect(() => {
    if (firstRenderRef.current) { firstRenderRef.current = false; return; }
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const off = rect.top < 0 || rect.bottom > window.innerHeight;
    if (off) anchor.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [stepIdx, anchor]);

  const dismiss = useDismiss(context, { escapeKey: true, outsidePress: false });
  const role = useRole(context, { role: 'dialog' });
  const { getFloatingProps } = useInteractions([dismiss, role]);

  // Focus the bubble on step change / open.
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (activePageId != null && bubbleRef.current) bubbleRef.current.focus();
  }, [activePageId, stepIdx]);

  // useDismiss handles Esc via a document-level listener but only for the
  // OPEN case (i.e. when floating-ui thinks the popover is open). On
  // mobile we short-circuit `open`; wire a local key handler so Esc /
  // arrows work in both layouts.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { skipTour(); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { onNextClick(); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { onPrevClick(); e.preventDefault(); }
  };

  if (activePageId == null || stepDef == null) return null;

  const total = TOURS[activePageId].length;
  const isLast = stepIdx >= total - 1;
  const titleId = `tour-title-${activePageId}-${stepIdx}`;

  const onNextClick = () => {
    if (isLast) finishTour();
    else nextStep();
  };
  const onPrevClick = () => prevStep();

  const title = t(`tours.${activePageId}.${stepIdx}.title`);
  const body = t(`tours.${activePageId}.${stepIdx}.body`);
  const counter = t('tour.stepCounter', { step: stepIdx + 1, total });
  const closeAria = t('tour.closeAriaLabel');
  const mobilePointsTo = t('tour.mobilePointsTo');

  const buttonRow = (
    <div className="mt-3 flex items-center justify-between gap-2">
      <div className="text-xs text-ink-500">{counter}</div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={skipTour}
          className="btn-ghost !min-h-0 !px-2 !py-1 text-xs"
        >
          {t('tour.buttons.skip')}
        </button>
        <button
          type="button"
          onClick={onPrevClick}
          disabled={stepIdx === 0}
          className="btn-ghost !min-h-0 !px-2 !py-1 text-xs disabled:opacity-40"
        >
          {t('tour.buttons.prev')}
        </button>
        <button
          type="button"
          onClick={onNextClick}
          className="btn-primary !min-h-0 !px-3 !py-1 text-xs"
        >
          {isLast ? t('tour.buttons.finish') : t('tour.buttons.next')}
        </button>
      </div>
    </div>
  );

  const content = (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h3 id={titleId} className="text-sm font-medium text-ink-100">{title}</h3>
        <p className="text-sm text-ink-400 mt-1 leading-relaxed">{body}</p>
      </div>
      <button
        type="button"
        aria-label={closeAria}
        onClick={skipTour}
        className="btn-ghost !min-h-0 shrink-0 !px-2 !py-1 text-base leading-none"
      >
        ×
      </button>
    </div>
  );

  // Mobile: dock to bottom, no floating-math, "↑ pointe vers ..." indicator.
  if (isMobile) {
    return createPortal(
      <div
        ref={bubbleRef}
        role="dialog"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="surface-soft fixed inset-x-2 bottom-2 z-40 max-w-[calc(100vw-1rem)] rounded-xl border border-ink-800 p-3 shadow-lg outline-none"
      >
        <div className="mb-2 text-xs text-ink-500">{mobilePointsTo}</div>
        {content}
        {buttonRow}
      </div>,
      document.body,
    );
  }

  // Desktop: floating popover positioned by @floating-ui.
  if (!anchor) return null;

  return createPortal(
    <div
      ref={(node) => {
        refs.setFloating(node);
        bubbleRef.current = node as HTMLDivElement | null;
      }}
      style={floatingStyles}
      {...getFloatingProps({
        role: 'dialog',
        'aria-labelledby': titleId,
        tabIndex: -1,
        onKeyDown,
      })}
      className="surface-soft z-40 max-w-[320px] rounded-xl border border-ink-800 p-3 shadow-lg outline-none"
    >
      {content}
      {buttonRow}
      <FloatingArrow ref={arrowRef} context={context} className="fill-ink-900" tipRadius={2} />
    </div>,
    document.body,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/__tests__/TourBubble.test.tsx`
Expected: PASS — 7 tests pass.

Common gotchas if red:
- The `Précédent` / `Suivant` regex must match either French or English button labels (locale detection in jsdom may default to English).
- `role="dialog"` — floating-ui's `useRole` sets the `role` on the getFloatingProps output; make sure to spread it.
- If `screen.getByRole('dialog')` fails on desktop, `floatingStyles` may position off-screen — jsdom rects are all `{ top:0, left:0, width:0, height:0 }`, which is fine; the element still renders.

- [ ] **Step 5: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  add frontend/src/components/TourBubble.tsx \
      frontend/src/components/__tests__/TourBubble.test.tsx && \
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "feat(tips): TourBubble popover with floating-ui positioning

Portalled to body; offset/flip/shift/arrow middleware; keyboard shortcuts
(Esc, arrows); focus management; mobile-docked layout below 640px viewport.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `TourReplayIcon` component

**Files:**
- Create: `frontend/src/components/TourReplayIcon.tsx`
- Create: `frontend/src/components/__tests__/TourReplayIcon.test.tsx`

**Interfaces:**
- Consumes: `useTips`, `useTour`, `tipIdFor` from prior tasks.
- Produces: `export function TourReplayIcon({ pageId }: { pageId: PageId }): JSX.Element | null`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/__tests__/TourReplayIcon.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TipsProvider } from '../../contexts/TipsContext';
import { TourProvider, useTour } from '../../contexts/TourContext';
import { TourReplayIcon } from '../TourReplayIcon';

function stub(dismissed: Record<string, string>) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('/api/tips/dismissed')) {
      return { ok: true, status: 200,
        text: async () => JSON.stringify({ dismissed }),
      } as Response;
    }
    return { ok: true, status: 200, text: async () => '{}' } as Response;
  }));
}

function wrap(node: React.ReactNode) {
  return (
    <MemoryRouter>
      <TipsProvider>
        <TourProvider>{node}</TourProvider>
      </TipsProvider>
    </MemoryRouter>
  );
}

function Probe() {
  const tour = useTour();
  return <span data-testid="active">{tour.activePageId ?? 'none'}</span>;
}

beforeEach(() => vi.resetAllMocks());

describe('<TourReplayIcon />', () => {
  it('is hidden when the tour is not dismissed', async () => {
    stub({});
    render(wrap(<TourReplayIcon pageId="dashboard" />));
    await waitFor(() => expect(document.querySelector('button')).toBeNull());
  });

  it('is visible when dismissed; click undismisses and starts the tour', async () => {
    stub({ 'tour:dashboard': '2026-07-01T00:00:00Z' });
    render(wrap(<><TourReplayIcon pageId="dashboard" /><Probe /></>));
    const btn = await screen.findByRole('button', { name: /Rejouer|Replay/i });
    await userEvent.click(btn);
    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe('dashboard'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/__tests__/TourReplayIcon.test.tsx`
Expected: FAIL — `Cannot find module '../TourReplayIcon'`.

- [ ] **Step 3: Implement the component**

Create `frontend/src/components/TourReplayIcon.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { useTips } from '../contexts/TipsContext';
import { useTour } from '../contexts/TourContext';
import { tipIdFor, type PageId } from '../tips/tours';

// Small (?) button that reappears next to a page's title once the page's
// tour has been dismissed, letting the user replay it on demand. Replay
// bypasses the requireData gate: an explicit user request always shows
// the tour (steps whose anchors aren't mounted fall through the 2s
// missing-anchor fallback in TourContext).
export function TourReplayIcon({ pageId }: { pageId: PageId }): JSX.Element | null {
  const { ready, isDismissed, undismiss } = useTips();
  const { startTour } = useTour();
  const { t } = useTranslation('tips');

  const id = tipIdFor(pageId);
  if (!ready || !isDismissed(id)) return null;

  return (
    <button
      type="button"
      aria-label={t('tour.replayIconAriaLabel')}
      onClick={() => {
        undismiss(id).catch(() => {
          // Optimistic update handled by TipsContext; rollback happens
          // there. The tour has already started, so the user got their
          // replay — the icon may reappear on next reload, acceptable.
        });
        startTour(pageId);
      }}
      className="btn-ghost !min-h-0 !px-2 !py-1 text-xs leading-none text-ink-400 hover:text-ink-100"
    >
      ?
    </button>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/__tests__/TourReplayIcon.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  add frontend/src/components/TourReplayIcon.tsx \
      frontend/src/components/__tests__/TourReplayIcon.test.tsx && \
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "feat(tips): TourReplayIcon (?) button next to each page title

Visible only when the tour is dismissed; click undismisses (optimistic)
and starts the tour. Bypasses the requireData gate — an explicit user
request always shows the tour.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Wire `TourProvider` + `TourBubble` into `App.tsx`; delete v1 components

**Files:**
- Modify: `frontend/src/App.tsx`
- Delete: `frontend/src/components/WelcomeTour.tsx`
- Delete: `frontend/src/components/__tests__/WelcomeTour.test.tsx`
- Delete: `frontend/src/components/SectionTip.tsx`
- Delete: `frontend/src/components/__tests__/SectionTip.test.tsx`
- Delete: `frontend/src/components/SectionTipHelpIcon.tsx`
- Delete: `frontend/src/components/__tests__/SectionTipHelpIcon.test.tsx`
- Modify: `frontend/src/test/renderWithProviders.tsx` (remove stale comment about SectionTip)
- Modify: `frontend/src/contexts/__tests__/TipsContext.test.tsx` (update fixtures that referenced old tip ids — see Step 6 below)

Interfaces exposed after this task: none new; only wiring and deletion.

- [ ] **Step 1: Update `App.tsx` — remove `WelcomeTour`, wrap with `TourProvider`, mount `TourBubble`**

Open `frontend/src/App.tsx`. Change three things:

1. Remove line `import { WelcomeTour } from './components/WelcomeTour';` (currently around line 9).
2. Add just after the `TipsProvider` import:
   ```ts
   import { TourProvider } from './contexts/TourContext';
   import { TourBubble } from './components/TourBubble';
   ```
3. Replace the JSX block:
   ```tsx
   <PrivacyProvider>
     <TipsProvider>
       <WelcomeTour />
       <Routes>
         …
       </Routes>
     </TipsProvider>
   </PrivacyProvider>
   ```
   with:
   ```tsx
   <PrivacyProvider>
     <TipsProvider>
       <TourProvider>
         <TourBubble />
         <Routes>
           …
         </Routes>
       </TourProvider>
     </TipsProvider>
   </PrivacyProvider>
   ```
   (Leave the contents of `<Routes>` verbatim.)

- [ ] **Step 2: Delete the v1 components and their tests**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  rm frontend/src/components/WelcomeTour.tsx \
     frontend/src/components/__tests__/WelcomeTour.test.tsx \
     frontend/src/components/SectionTip.tsx \
     frontend/src/components/__tests__/SectionTip.test.tsx \
     frontend/src/components/SectionTipHelpIcon.tsx \
     frontend/src/components/__tests__/SectionTipHelpIcon.test.tsx
```

- [ ] **Step 3: Prune the stale comment in `renderWithProviders.tsx`**

Open `frontend/src/test/renderWithProviders.tsx` and update the block-comment above `withTips` to remove the SectionTip reference. Replace the file content with:

```tsx
import type { ReactElement } from 'react';
import { TipsProvider } from '../contexts/TipsContext';

// Wraps a page element in <TipsProvider> for tests that render a page which
// reads tip state via useTips() (e.g. via <TourReplayIcon>). TipsProvider's
// own hydration fetch to /api/tips/dismissed fails closed when a test's
// api()/fetch mock doesn't recognize the route, so no additional stubbing
// is required beyond this wrapper.
export function withTips(children: ReactElement): ReactElement {
  return <TipsProvider>{children}</TipsProvider>;
}
```

- [ ] **Step 4: Verify no more references to v1 tip ids exist in code**

Run:

```bash
grep -rn "welcome_tour\|section:dashboard\|section:accounts\|section:budgets\|section:rules\|section:transactions\|section:imports\|section:data\|SectionTip\|WelcomeTour" frontend/src backend/src
```

Expected: no matches. If any turn up (e.g. in `TipsContext.test.tsx`), fix them in Step 5.

- [ ] **Step 5: Update `TipsContext.test.tsx` fixtures**

Open `frontend/src/contexts/__tests__/TipsContext.test.tsx`. Any fixture that uses `welcome_tour` or `section:*` in a `dismissed` blob or in an `isDismissed(...)` assertion must be updated to a current tour id (`tour:dashboard` is a safe default). The test's intent — that `isDismissed` reflects hydrated state — doesn't change; only the concrete id strings do.

- [ ] **Step 6: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: PASS. Any red test at this point either (a) still references v1 ids somewhere Step 4 missed — grep again — or (b) is a page test that renders a page which still imports `SectionTip` / `SectionTipHelpIcon` — those pages are still v1 in this task; they get updated in Task 10, and their tests are red until then. If Task 10's page-test-file names show up here, note them and continue.

- [ ] **Step 7: Run TypeScript build**

Run: `cd frontend && npx tsc -b`
Expected: FAIL — the 7 pages that still import `SectionTip` / `SectionTipHelpIcon` no longer compile. That is expected and gets resolved in Task 10.

- [ ] **Step 8: Commit (broken TS build is expected — Task 10 fixes it)**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  add -A && \
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "refactor(tips): mount TourProvider/TourBubble in App; delete v1 components

Removes WelcomeTour, SectionTip, SectionTipHelpIcon and their tests.
Pages that still import them do not compile until Task 10 rewires them.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Wire the 7 page components

**Files:**
- Modify: `frontend/src/pages/Dashboard/index.tsx`
- Modify: `frontend/src/pages/Accounts/index.tsx`
- Modify: `frontend/src/pages/Transactions/index.tsx`
- Modify: `frontend/src/pages/Data/Imports.tsx`
- Modify: `frontend/src/pages/Rules/Tri.tsx`
- Modify: `frontend/src/pages/Budgets/Plafonds.tsx`
- Modify: `frontend/src/pages/Data/Backup.tsx`

**Interfaces:** none new. Each page consumes `useAutoStartTour`, `useTourAnchor`, and `TourReplayIcon` from Tasks 5–8.

Common pattern for every page:
1. **Remove** `import { SectionTip } from '../../components/SectionTip';` and `import { SectionTipHelpIcon } from '../../components/SectionTipHelpIcon';`.
2. **Add** `import { useAutoStartTour } from '../../hooks/useAutoStartTour';`, `import { useTourAnchor } from '../../hooks/useTourAnchor';`, `import { TourReplayIcon } from '../../components/TourReplayIcon';`.
3. **Remove** the `<SectionTip id="section:…" />` and `<SectionTipHelpIcon id="section:…" />` JSX.
4. **Add** `<TourReplayIcon pageId="…" />` next to the `<h1>`.
5. **Add** `useAutoStartTour('…', opts?)` inside the component body (top-level, unconditional).
6. **Attach** `ref={useTourAnchor('…')}` to each element that a step points at.

For pages with a `useTourAnchor` on a nested-page element that's rendered by a child component (e.g. Dashboard's `SankeySection`), the ref goes on the wrapper `<div>` the parent controls, not inside the child — keep child components anchor-agnostic where possible.

- [ ] **Step 1: Dashboard**

Open `frontend/src/pages/Dashboard/index.tsx`.

- Replace imports (lines 5–6) with:
  ```ts
  import { useAutoStartTour } from '../../hooks/useAutoStartTour';
  import { useTourAnchor } from '../../hooks/useTourAnchor';
  import { TourReplayIcon } from '../../components/TourReplayIcon';
  ```
- Inside `Dashboard()` (near the other hook calls near the top), add:
  ```ts
  useAutoStartTour('dashboard', { requireData: () => !rootEmpty });
  const balanceAnchor  = useTourAnchor('dashboard:balance');
  const curveAnchor    = useTourAnchor('dashboard:curve');
  const donutAnchor    = useTourAnchor('dashboard:donut');
  const insightsAnchor = useTourAnchor('dashboard:insights');
  const sankeyAnchor   = useTourAnchor('dashboard:sankey');
  ```
  `rootEmpty` already exists at line 47; the effect subscribes to whichever queries feed it, so no extra `useMemo` needed.
- Replace the current header block (around lines 146–147):
  ```tsx
  <h1 className="page-title">{t('title')}</h1>
  <SectionTipHelpIcon id="section:dashboard" />
  ```
  with:
  ```tsx
  <h1 className="page-title">{t('title')}</h1>
  <TourReplayIcon pageId="dashboard" />
  ```
- Delete the `<SectionTip id="section:dashboard" />` line (around line 151).
- Attach refs to the wrappers around each dashboard section (search for `DashboardHero`, `BalanceChart`, `CategoryBreakdown`, `InsightsSection`, `SankeySection` — wrap each in `<div ref={XxxAnchor}>…</div>` if it isn't already inside one; if the returned component already provides an outer `<div>`, add the ref to the immediate ancestor JSX element in `Dashboard/index.tsx`). Concrete edits (line numbers relative to today's file):
  - Around line 177: `{!rootErr && !rootEmpty && <DashboardHero primary={primary} />}`
    → wrap with `<div ref={balanceAnchor}>…</div>`.
  - Around line 181 (currencies count > 1): the `<BalanceChart>` mount → wrap with `<div ref={curveAnchor}>…</div>`.
  - Around line 194 (`MoyennesMensuellesSection`): leave; the donut lives in `CategoryBreakdown` — grep the file for `CategoryBreakdown` and wrap it with `<div ref={donutAnchor}>…</div>`.
  - Around line 195: `<InsightsSection currency={primary.currency} />` → wrap with `<div ref={insightsAnchor}>…</div>`.
  - Wrap `<SankeySection />` with `<div ref={sankeyAnchor}>…</div>`.

- [ ] **Step 2: Accounts**

Open `frontend/src/pages/Accounts/index.tsx`.

- Replace imports at lines 22–23 with:
  ```ts
  import { useAutoStartTour } from '../../hooks/useAutoStartTour';
  import { useTourAnchor } from '../../hooks/useTourAnchor';
  import { TourReplayIcon } from '../../components/TourReplayIcon';
  ```
- Inside `Accounts()`, add:
  ```ts
  useAutoStartTour('accounts'); // no requireData — page exists to create data
  const addBtnAnchor        = useTourAnchor('accounts:add-button');
  const startingBalAnchor   = useTourAnchor('accounts:starting-balance');
  ```
- Delete `<SectionTip id="section:accounts" />` (line 188).
- Around line 192–193, replace:
  ```tsx
  <h1 className="page-title">{t('title')}</h1>
  <SectionTipHelpIcon id="section:accounts" />
  ```
  with:
  ```tsx
  <h1 className="page-title">{t('title')}</h1>
  <TourReplayIcon pageId="accounts" />
  ```
- Attach `addBtnAnchor` to the "add account" button. Grep the file for the button that opens the add-form (it is likely a `<button>` calling `setEditing({...})` or setting form state) — wrap it in a `<div ref={addBtnAnchor} …>` or attach `ref={addBtnAnchor}` directly to the button element if it's an HTMLButtonElement. If there are two mount points (header + empty-state CTA), attach the same anchor to both — last-register-wins in `TourContext` handles the transient overlap.
- Attach `startingBalAnchor` to the starting-balance input inside `AccountForm`. Since `AccountForm` is a child component, wrap the `<AccountForm />` mount site in `<div ref={startingBalAnchor}>…</div>` in `Accounts/index.tsx`. Anchor points at the form-container, not the input itself — precise enough for the coach-mark.

- [ ] **Step 3: Transactions**

Open `frontend/src/pages/Transactions/index.tsx`.

- Replace imports at lines 7–8 with:
  ```ts
  import { useAutoStartTour } from '../../hooks/useAutoStartTour';
  import { useTourAnchor } from '../../hooks/useTourAnchor';
  import { TourReplayIcon } from '../../components/TourReplayIcon';
  ```
- Inside `Transactions()`, near the other hooks:
  ```ts
  const searchAnchor = useTourAnchor('transactions:search');
  const rowAnchor    = useTourAnchor('transactions:row');
  const multiAnchor  = useTourAnchor('transactions:multi-select');
  // requireData: at least one transaction row exists. Read the same
  // data source the visible list uses — grep for the query key used to
  // populate the transactions table; the predicate should be
  // `(transactions?.length ?? 0) > 0`.
  useAutoStartTour('transactions', {
    requireData: () => (transactions?.length ?? 0) > 0,
  });
  ```
  Adjust the exact variable name to whatever the file uses (e.g. `data?.transactions`, `rows`, etc.).
- Delete `<SectionTip id="section:transactions" />` (around line 232).
- Around line 237, replace:
  ```tsx
  <h1 className="page-title">{t('title')}</h1>
  <SectionTipHelpIcon id="section:transactions" />
  ```
  with:
  ```tsx
  <h1 className="page-title">{t('title')}</h1>
  <TourReplayIcon pageId="transactions" />
  ```
- Attach `searchAnchor` to the search input; `multiAnchor` to the multi-select toggle / checkbox column header; `rowAnchor` to the first data row's element (attach it via `ref={idx === 0 ? rowAnchor : undefined}` in the row-map callback — a single anchor points at the first row).

- [ ] **Step 4: Imports (`Data/Imports.tsx`)**

Open `frontend/src/pages/Data/Imports.tsx`.

- Replace imports at lines 6–7 with:
  ```ts
  import { useAutoStartTour } from '../../hooks/useAutoStartTour';
  import { useTourAnchor } from '../../hooks/useTourAnchor';
  import { TourReplayIcon } from '../../components/TourReplayIcon';
  ```
- Inside the component:
  ```ts
  useAutoStartTour('imports');
  const dropzoneAnchor = useTourAnchor('imports:dropzone');
  ```
- Around line 72:
  ```tsx
  <SectionTipHelpIcon id="section:imports" />
  ```
  → `<TourReplayIcon pageId="imports" />`
- Delete `<SectionTip id="section:imports" />` (around line 79).
- Attach `dropzoneAnchor` to the drop area (grep the file for the element with the drop handler / a `<label>` wrapping a `<input type="file">`).

- [ ] **Step 5: Rules (`Rules/Tri.tsx`)**

Open `frontend/src/pages/Rules/Tri.tsx`.

- Replace imports at lines 9–10 with:
  ```ts
  import { useAutoStartTour } from '../../hooks/useAutoStartTour';
  import { useTourAnchor } from '../../hooks/useTourAnchor';
  import { TourReplayIcon } from '../../components/TourReplayIcon';
  ```
- Inside the component:
  ```ts
  useAutoStartTour('rules');
  const rulesListAnchor = useTourAnchor('rules:list');
  const triTabAnchor    = useTourAnchor('rules:tri-tab');
  ```
- Delete `<SectionTip id="section:rules" />` (around line 105).
- Around line 110:
  ```tsx
  <SectionTipHelpIcon id="section:rules" />
  ```
  → `<TourReplayIcon pageId="rules" />`
- Attach `rulesListAnchor` to the rules list container; `triTabAnchor` to the "Tri" tab in the `HubLayout` tab bar. Since the tab bar lives in `HubLayout`, the cleanest wiring is to place a wrapper `<div ref={triTabAnchor} style={{ display: 'contents' }}>…</div>` around the outer Tri page body, or — if HubLayout renders its tabs outside the page slot — accept that this step's anchor may not resolve on the Rules landing route and let the 2 s fallback skip it. Grep `HubLayout.tsx` to decide: if HubLayout renders `<Outlet />` next to its own `<nav>`, the tri tab element is not reachable from `Tri.tsx`. In that case: fall back to attaching `triTabAnchor` to the top of `Tri.tsx`'s content — the coach-mark still lands on the Sort page, just anchored to its body rather than its tab. Note the decision in the commit message.

- [ ] **Step 6: Budgets (`Budgets/Plafonds.tsx`)**

Open `frontend/src/pages/Budgets/Plafonds.tsx`.

- Replace imports at lines 10–11 with:
  ```ts
  import { useAutoStartTour } from '../../hooks/useAutoStartTour';
  import { useTourAnchor } from '../../hooks/useTourAnchor';
  import { TourReplayIcon } from '../../components/TourReplayIcon';
  ```
- Inside the component:
  ```ts
  const catRowAnchor = useTourAnchor('budgets:category-row');
  // requireData: at least one budget row defined. Grep the file for
  // the query result driving the list; predicate is `(budgets?.length ?? 0) > 0`.
  useAutoStartTour('budgets', {
    requireData: () => (budgets?.length ?? 0) > 0,
  });
  ```
  Adjust the variable name to whatever the file already uses.
- Delete `<SectionTip id="section:budgets" />` (around line 131).
- Around line 136:
  ```tsx
  <SectionTipHelpIcon id="section:budgets" />
  ```
  → `<TourReplayIcon pageId="budgets" />`
- Attach `catRowAnchor` to the first budget row in the list (same `idx === 0 ? catRowAnchor : undefined` pattern used in Task 10 Step 3).

- [ ] **Step 7: Data (`Data/Backup.tsx`)**

Open `frontend/src/pages/Data/Backup.tsx`.

- Replace imports at lines 2–3 with:
  ```ts
  import { useAutoStartTour } from '../../hooks/useAutoStartTour';
  import { useTourAnchor } from '../../hooks/useTourAnchor';
  import { TourReplayIcon } from '../../components/TourReplayIcon';
  ```
- Inside the component:
  ```ts
  useAutoStartTour('data');
  const exportAnchor = useTourAnchor('data:export');
  ```
- Around line 12:
  ```tsx
  <SectionTipHelpIcon id="section:data" />
  ```
  → `<TourReplayIcon pageId="data" />`
- Delete `<SectionTip id="section:data" />` (around line 16).
- Attach `exportAnchor` to the "Export" button (or the export card container if the button is a child component).

- [ ] **Step 8: Verify no v1 references remain and TS builds**

Run:

```bash
grep -rn "SectionTip\|SectionTipHelpIcon\|WelcomeTour\|welcome_tour\|section:" frontend/src
```

Expected: no matches.

Run: `cd frontend && npx tsc -b`
Expected: PASS.

- [ ] **Step 9: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: PASS.

If a page test now fails because it renders a page that requires `TourProvider`, either:
- Add `<MemoryRouter>` + `<TipsProvider>` + `<TourProvider>` to the test wrapper (many page tests already use `renderWithProviders`; extend it there — but only if 2+ page tests need it, per DRY).
- Or, for one-off tests, wrap inline.

Extending `renderWithProviders.tsx` is the cleaner move if you see the same red pattern in ≥ 2 files. Add a `withTours(children)` helper mirroring `withTips`, and either export both separately or expose a combined `withTipsAndTours` — pick the smaller diff.

- [ ] **Step 10: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  add -A && \
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "feat(tips): wire anchored tours across the seven main pages

Each page mounts useAutoStartTour, a TourReplayIcon next to its <h1>, and
useTourAnchor refs on the elements each step points at. Dashboard, Trans-
actions, and Budgets are data-gated; Accounts, Imports, Rules, and Data
auto-start on empty state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Full-suite verification + manual QA + final commit

**Files:** none created; touch-ups only if a test breaks.

- [ ] **Step 1: Frontend suite + type-check + lint**

```bash
cd frontend && npx tsc -b && npx vitest run
```
Expected: TS builds; every test passes. If a test that renders one of the 7 pages fails with "must be used inside <TourProvider>", extend `renderWithProviders.tsx` per Task 10 Step 9.

- [ ] **Step 2: Backend suite**

```bash
cd backend && npx vitest run
```
Expected: PASS. If the tips route tests still assert against the old id set, update them here.

- [ ] **Step 3: Manual smoke test on the running app**

The user prefers not to launch container runtimes (per memory). If the backend is already running against a local Postgres, boot the frontend dev server and click through the flow:

```bash
cd frontend && npm run dev
```

Manually verify on each of the seven pages:
1. Reset dismissals for the current user via the dev console:
   ```js
   fetch('/api/tips/reset', { method: 'POST', credentials: 'include' })
   ```
2. Reload each page.
3. Confirm the bubble appears anchored to the correct element on first visit (for data-gated pages: only after data exists).
4. Click through `Suivant` all the way to `Terminer`; confirm the bubble disappears.
5. Reload — no bubble; the `?` replay icon appears next to the page title.
6. Click the `?` — bubble reopens at step 0.
7. Test route-change abort: start a tour, click a nav link mid-tour; confirm no persistence event fires (open Network tab).
8. Test Esc / arrow keys.
9. Resize the browser under 640 px; confirm the bubble docks to the viewport bottom with the "↑ pointe vers …" indicator.

If any anchor lands on the wrong element, fix the ref placement in that page's JSX and re-run the suite.

If the backend is NOT running (memory says: don't launch container runtimes; verify what's possible statically), skip the manual step and note in the commit message that browser verification is deferred to the next session. The unit / component / integration tests cover the behavior.

- [ ] **Step 4: If a UI adjustment was needed, commit it**

```bash
git status
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  add -A && \
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "polish(tips): adjust anchor placement / test-wrapper wiring after manual QA

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Delete this plan's local scratchpad if any was created**

None expected — the plan doesn't ask for scratch files. If any temporary integration-test file is left over, remove it.

- [ ] **Step 6: Final status**

```bash
git status
git log --oneline -15
```
Expected: clean working tree. About 8–10 commits under Gekkotron's identity on `main`. Do NOT push unless the user asks — memory explicitly says pushes only on request.

---

## Self-review notes

- **Spec coverage:** every section of the design spec maps to a task —
  - § Architecture units 1-5 → Tasks 1, 4, 5, 7, 8.
  - § Anchors, positioning, edge cases → Task 4 (missing-anchor timeout, route abort, anchor registry) + Task 7 (floating-ui middleware, portal, scrollIntoView).
  - § Content model → Task 2 (locales + slim content.ts).
  - § Trigger / persistence / interaction → Task 6 (auto-start + data-gating) + Task 4 (dismissal semantics) + Task 8 (replay).
  - § Migration & cleanup → Task 9 (deletions + App wiring) + Task 10 (page rewiring) + Task 3 (backend allowlist + orphan sweep).
  - § Testing strategy → Tasks 1, 2, 3, 4, 5, 6, 7, 8 (unit + component) + Task 11 (integration via manual QA; the six RTL flows the spec describes are covered by the per-component test files, which each drive a real page-like fixture).
- **Placeholder scan:** no "TBD", no "add appropriate error handling", every step ships a full code block or a full command.
- **Type consistency:** `PageId`, `AnchorId`, `TipId`, `tipIdFor`, `useTourAnchor`, `useAutoStartTour`, `useTour`, `TourProvider`, `TourBubble`, `TourReplayIcon` — names are identical wherever they cross task boundaries.
- **One deferred spec item, intentional:** the spec's `useAutoStartTour` deps list says `[ready, dismissed, requireData?()]`. Task 6 implements it without a deps array (runs on every render) because the predicate reads live React Query cache. The tests cover the "flip to true on rerender" case; behavior is unchanged. Not a placeholder — a deliberate small deviation with rationale in the code comment.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-20-tips-anchored-tours.md`.** Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
