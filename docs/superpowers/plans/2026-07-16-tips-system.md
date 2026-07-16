# Tips System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a first-launch welcome tour plus a first-visit inline tip card on each of the seven main sections, with server-side per-user dismissal and two replay paths (Réglages reset button; per-section (?) icon).

**Architecture:** New JSONB column `dismissed_tips` on `user_settings`; four small Fastify endpoints under `/api/tips`; one React context that hydrates dismissed ids and exposes `dismiss` / `undismiss` / `reset`; a single `<WelcomeTour />` mounted at App root, an inline `<SectionTip id="…" />` placed at the top of each of the seven pages, and a `<SectionTipHelpIcon />` in the shared `Layout` header for single-tip replay.

**Tech Stack:** TypeScript, Fastify, Drizzle ORM, PostgreSQL, React, React Router, TanStack Query, Vitest, React Testing Library. All UI copy in French.

## Global Constraints

- Public-safe: no IPs, hostnames, or secrets in commits.
- Work directly on `main`; commit after each task; push only when the user asks.
- Attribute all commits to Gekkotron via `-c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com`.
- Backend tests hit a real DB (never mocks), gated on `RUN_DB_TESTS=1`, matching the pattern in `backend/tests/settings-route.test.ts`.
- French decimal inputs: not relevant here (no numeric inputs in this feature) but keep the project rule in mind if any get added.
- All UI copy is French; do not add i18n.
- No coach-mark overlays; the section tip is a plain inline card.
- Frozen tip id allow-list: `welcome_tour`, `section:dashboard`, `section:imports`, `section:transactions`, `section:rules`, `section:budgets`, `section:accounts`, `section:data`.

## Section id → mounting-page map

The seven `section:*` ids map to concrete routes as follows (locked in by this plan; if the spec's frozen ids change, update both allow-lists and this map together):

| Tip id                  | Rendered inside                              | Route          |
|-------------------------|----------------------------------------------|----------------|
| `section:dashboard`     | `frontend/src/pages/Dashboard/index.tsx`     | `/`            |
| `section:transactions`  | `frontend/src/pages/Transactions/index.tsx`  | `/transactions`|
| `section:budgets`       | `frontend/src/pages/Budgets/index.tsx`       | `/budgets`     |
| `section:rules`         | `frontend/src/pages/Rules/Tri.tsx` (the Rules hub default tab) | `/regles/tri` |
| `section:accounts`      | `frontend/src/pages/Accounts/index.tsx`      | `/comptes`     |
| `section:imports`       | `frontend/src/pages/Data/Imports.tsx`        | `/donnees/imports` |
| `section:data`          | `frontend/src/pages/Data/Backup.tsx`         | `/donnees/sauvegarde` |

Verify each `index.tsx` path in Task 9 — the exact filename per page follows the existing folder-with-index convention seen under `frontend/src/pages/Dashboard/`.

---

## Task 1: DB migration + Drizzle schema

**Files:**
- Create: `backend/src/db/migrations/0021_dismissed_tips.sql`
- Modify: `backend/src/db/schema.ts` (add `dismissedTips` column to the `userSettings` table around line 413)

**Interfaces:**
- Consumes: nothing.
- Produces: `userSettings.dismissedTips` typed as `Record<string, string>` in Drizzle; `user_settings.dismissed_tips` JSONB column with default `'{}'::jsonb` in Postgres.

- [ ] **Step 1: Write the migration SQL**

Create `backend/src/db/migrations/0021_dismissed_tips.sql`:

```sql
-- Store dismissed tip ids per user. Value is a JSONB object mapping the
-- frozen tip id to the ISO-8601 dismissal timestamp. Missing key = not
-- dismissed. See docs/superpowers/specs/2026-07-16-tips-system-design.md.
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS dismissed_tips JSONB NOT NULL DEFAULT '{}'::jsonb;
```

- [ ] **Step 2: Add the column to the Drizzle schema**

In `backend/src/db/schema.ts`, inside the `userSettings = pgTable('user_settings', { ... })` block, add:

```ts
dismissedTips: jsonb('dismissed_tips')
  .$type<Record<string, string>>()
  .notNull()
  .default({}),
```

- [ ] **Step 3: Run migrations against the local DB**

Run: `RUN_DB_TESTS=1 npm --prefix backend run test -- --run backend/tests/settings-route.test.ts`

Expected: existing settings tests still pass (they touch the same table). If they fail, revert and debug the migration.

- [ ] **Step 4: Add a smoke test for the new column**

In `backend/tests/settings-route.test.ts`, add one new test at the bottom of the top-level `describe.skipIf(!RUN)('/api/settings', () => { … })` block:

```ts
it('user_settings has a dismissed_tips column defaulting to {}', async () => {
  const { db } = await import('../src/db/client.js');
  const { userSettings } = await import('../src/db/schema.js');
  await db.insert(userSettings).values({ userId: 1 }).onConflictDoNothing();
  const rows = await db.select().from(userSettings);
  expect(rows[0]?.dismissedTips).toEqual({});
});
```

- [ ] **Step 5: Run the smoke test to verify it passes**

Run: `RUN_DB_TESTS=1 npm --prefix backend run test -- --run backend/tests/settings-route.test.ts`

Expected: all settings tests pass, including the new column smoke test.

- [ ] **Step 6: Commit**

```bash
git add backend/src/db/migrations/0021_dismissed_tips.sql \
        backend/src/db/schema.ts \
        backend/tests/settings-route.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
    commit -m "$(cat <<'EOF'
feat(backend): add dismissed_tips JSONB column to user_settings

Foundation for the first-visit tips system. Column defaults to '{}',
mapping tip id to ISO dismissal timestamp. See spec for the frozen id
allow-list.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Backend `/api/tips` endpoints

**Files:**
- Create: `backend/src/http/routes/tips/tip-ids.ts`
- Create: `backend/src/http/routes/tips/index.ts`
- Modify: `backend/src/server.ts` (add import + `app.register(tipsRoutes)` after `app.register(settingsRoutes)`)
- Create: `backend/tests/tips-route.test.ts`

**Interfaces:**
- Consumes: `userSettings.dismissedTips` from Task 1; `authPlugin`'s `requireAuth` hook (same pattern as `settings.ts`).
- Produces:
  - `TIP_IDS: readonly [...]` in `backend/src/http/routes/tips/tip-ids.ts` — used later by the registry-alignment test in Task 4.
  - HTTP endpoints:
    - `GET  /api/tips/dismissed         → 200 { dismissed: Record<string,string> }`
    - `POST /api/tips/dismiss   { id }  → 204`
    - `POST /api/tips/undismiss { id }  → 204`
    - `POST /api/tips/reset             → 204`

- [ ] **Step 1: Create the shared TIP_IDS module**

Create `backend/src/http/routes/tips/tip-ids.ts`:

```ts
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
```

- [ ] **Step 2: Write the failing route tests**

Create `backend/tests/tips-route.test.ts`:

```ts
// requires Postgres + onboarding setup — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

const RUN = !!process.env.RUN_DB_TESTS;

let app: FastifyInstance;
let cookie: string;

describe.skipIf(!RUN)('/api/tips', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();

    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'tips', password: 'tips-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'tips', password: 'tips-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;
  });

  afterEach(async () => {
    const { db } = await import('../src/db/client.js');
    const { userSettings } = await import('../src/db/schema.js');
    await db.delete(userSettings);
  });

  it('GET /dismissed without auth → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tips/dismissed' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /dismissed for a fresh user returns {}', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/tips/dismissed', headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ dismissed: {} });
  });

  it('POST /dismiss known id → 204, subsequent GET reflects it', async () => {
    const post = await app.inject({
      method: 'POST', url: '/api/tips/dismiss', headers: { cookie },
      payload: { id: 'welcome_tour' },
    });
    expect(post.statusCode).toBe(204);

    const get = await app.inject({
      method: 'GET', url: '/api/tips/dismissed', headers: { cookie },
    });
    const dismissed = get.json().dismissed as Record<string, string>;
    expect(Object.keys(dismissed)).toEqual(['welcome_tour']);
    expect(new Date(dismissed.welcome_tour).getTime())
      .toBeGreaterThan(Date.now() - 60_000);
  });

  it('POST /dismiss unknown id → 400, column unchanged', async () => {
    const post = await app.inject({
      method: 'POST', url: '/api/tips/dismiss', headers: { cookie },
      payload: { id: 'not_a_real_tip' },
    });
    expect(post.statusCode).toBe(400);
    expect(post.json()).toMatchObject({ error: 'unknown_tip_id' });

    const get = await app.inject({
      method: 'GET', url: '/api/tips/dismissed', headers: { cookie },
    });
    expect(get.json()).toEqual({ dismissed: {} });
  });

  it('POST /undismiss removes the key', async () => {
    await app.inject({
      method: 'POST', url: '/api/tips/dismiss', headers: { cookie },
      payload: { id: 'section:dashboard' },
    });
    const un = await app.inject({
      method: 'POST', url: '/api/tips/undismiss', headers: { cookie },
      payload: { id: 'section:dashboard' },
    });
    expect(un.statusCode).toBe(204);

    const get = await app.inject({
      method: 'GET', url: '/api/tips/dismissed', headers: { cookie },
    });
    expect(get.json()).toEqual({ dismissed: {} });
  });

  it('POST /undismiss unknown id → 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/tips/undismiss', headers: { cookie },
      payload: { id: 'not_a_real_tip' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /reset clears the blob', async () => {
    await app.inject({
      method: 'POST', url: '/api/tips/dismiss', headers: { cookie },
      payload: { id: 'welcome_tour' },
    });
    await app.inject({
      method: 'POST', url: '/api/tips/dismiss', headers: { cookie },
      payload: { id: 'section:budgets' },
    });
    const reset = await app.inject({
      method: 'POST', url: '/api/tips/reset', headers: { cookie },
    });
    expect(reset.statusCode).toBe(204);

    const get = await app.inject({
      method: 'GET', url: '/api/tips/dismissed', headers: { cookie },
    });
    expect(get.json()).toEqual({ dismissed: {} });
  });

  it('all endpoints require auth', async () => {
    for (const url of ['/api/tips/dismissed']) {
      const r = await app.inject({ method: 'GET', url });
      expect(r.statusCode).toBe(401);
    }
    for (const [method, url] of [
      ['POST', '/api/tips/dismiss'],
      ['POST', '/api/tips/undismiss'],
      ['POST', '/api/tips/reset'],
    ] as const) {
      const r = await app.inject({ method, url, payload: { id: 'welcome_tour' } });
      expect(r.statusCode).toBe(401);
    }
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `RUN_DB_TESTS=1 npm --prefix backend run test -- --run backend/tests/tips-route.test.ts`

Expected: all `/api/tips` tests FAIL (route not registered → 404 for the authenticated ones, 401 stays 401 which coincidentally passes but the rest fail).

- [ ] **Step 4: Implement the route handlers**

Create `backend/src/http/routes/tips/index.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { userSettings } from '../../../db/schema.js';
import { TIP_IDS } from './tip-ids.js';

const idBody = z.object({ id: z.enum(TIP_IDS) });

export async function tipsRoutes(app: FastifyInstance) {
  app.get('/api/tips/dismissed', { preHandler: [app.requireAuth] }, async (req) => {
    const userId = req.userId!;
    const rows = await db
      .select({ dismissedTips: userSettings.dismissedTips })
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .limit(1);
    return { dismissed: rows[0]?.dismissedTips ?? {} };
  });

  app.post('/api/tips/dismiss', { preHandler: [app.requireAuth] }, async (req, reply) => {
    const parsed = idBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'unknown_tip_id' });
    const userId = req.userId!;
    const id = parsed.data.id;
    // Upsert so this works even if user_settings has no row yet.
    await db.execute(
      `INSERT INTO user_settings (user_id, dismissed_tips)
       VALUES ($1, jsonb_build_object($2::text, to_jsonb(NOW()::text)))
       ON CONFLICT (user_id) DO UPDATE
         SET dismissed_tips =
             user_settings.dismissed_tips || jsonb_build_object($2::text, to_jsonb(NOW()::text))`,
      [userId, id],
    );
    return reply.status(204).send();
  });

  app.post('/api/tips/undismiss', { preHandler: [app.requireAuth] }, async (req, reply) => {
    const parsed = idBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'unknown_tip_id' });
    const userId = req.userId!;
    await db.execute(
      `UPDATE user_settings SET dismissed_tips = dismissed_tips - $2::text WHERE user_id = $1`,
      [userId, parsed.data.id],
    );
    return reply.status(204).send();
  });

  app.post('/api/tips/reset', { preHandler: [app.requireAuth] }, async (req, reply) => {
    const userId = req.userId!;
    await db.execute(
      `UPDATE user_settings SET dismissed_tips = '{}'::jsonb WHERE user_id = $1`,
      [userId],
    );
    return reply.status(204).send();
  });
}
```

Adapt the exact `db.execute` call syntax to match this project's Drizzle usage — inspect `backend/src/http/routes/settings.ts` for the local convention (parameterized queries via `sql\`…\`` template vs. `.execute(sql, params)`; both are valid Drizzle patterns). Use the same one to stay consistent.

- [ ] **Step 5: Register the route in `server.ts`**

In `backend/src/server.ts`:

Add the import at the top, next to the other route imports (around line 27):

```ts
import { tipsRoutes } from './http/routes/tips/index.js';
```

Add the registration in the authenticated-routes block, immediately after `await app.register(settingsRoutes);` (around line 75):

```ts
  await app.register(tipsRoutes);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `RUN_DB_TESTS=1 npm --prefix backend run test -- --run backend/tests/tips-route.test.ts`

Expected: PASS on all `/api/tips` tests.

- [ ] **Step 7: Run the full backend test suite for regressions**

Run: `RUN_DB_TESTS=1 npm --prefix backend run test`

Expected: no test that previously passed now fails.

- [ ] **Step 8: Commit**

```bash
git add backend/src/http/routes/tips \
        backend/src/server.ts \
        backend/tests/tips-route.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
    commit -m "$(cat <<'EOF'
feat(backend): /api/tips endpoints for dismiss/undismiss/reset

Four session-authed endpoints backing the first-visit tips system.
Body validation uses a frozen zod enum of the eight allowed tip ids;
unknown ids return 400. Handlers upsert into user_settings so they
work for users with no settings row yet.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Frontend content registry

**Files:**
- Create: `frontend/src/tips/content.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `TIP_IDS: readonly [...]` (identical shape to backend's `TIP_IDS`).
  - `TipId` type alias.
  - `SECTION_TIPS: Record<Exclude<TipId, 'welcome_tour'>, { title: string; body: string }>`.
  - `WELCOME_STEPS: Array<{ title: string; body: string }>`.

- [ ] **Step 1: Create the registry file**

Create `frontend/src/tips/content.ts`:

```ts
// Central registry for tip ids and their French copy. The array below
// must stay in lock-step with backend/src/http/routes/tips/tip-ids.ts;
// a Vitest test in Task 4 asserts literal equality.

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

export const SECTION_TIPS: Record<
  Exclude<TipId, 'welcome_tour'>,
  { title: string; body: string }
> = {
  'section:dashboard': {
    title: 'Bienvenue sur le tableau de bord',
    body: "Vous y voyez le solde de vos comptes, la courbe du solde et vos dépenses par catégorie. Cliquez sur une catégorie du donut pour filtrer les transactions.",
  },
  'section:imports': {
    title: 'Importer vos relevés',
    body: "Glissez un fichier OFX, CSV ou PDF. La première fois qu'un PDF d'une banque est importé, un assistant vous demande de désigner les zones montant/date/libellé — les imports suivants sont automatiques.",
  },
  'section:transactions': {
    title: 'Rechercher, corriger, ventiler',
    body: "La recherche ignore les accents et la casse. Vous pouvez ventiler une transaction en plusieurs sous-lignes, éditer une catégorie en ligne, ou sélectionner plusieurs transactions pour les supprimer d'un coup.",
  },
  'section:rules': {
    title: 'Catégorisation automatique',
    body: "Les règles s'appliquent aux nouveaux imports et peuvent être ré-appliquées rétroactivement sans écraser vos catégories manuelles. Depuis l'onglet Tri, vous pouvez créer une règle à partir d'un mot-clé en un clic.",
  },
  'section:budgets': {
    title: 'Suivi de budget mensuel',
    body: "Pour chaque catégorie de dépenses, définissez un montant prévu et suivez l'écart en temps réel. Les catégories en dépassement passent au rouge.",
  },
  'section:accounts': {
    title: 'Vos comptes',
    body: "Ajoutez un compte courant, un livret, un PEA… Le solde de départ est obligatoire : tous les soldes sont calculés à partir de là. L'argent bloqué (PEA, dépôt à terme) est isolé du montant disponible.",
  },
  'section:data': {
    title: 'Sauvegarde et restauration',
    body: "Exportez un backup complet (comptes, transactions, checkpoints, ventilations) et ré-importez-le sur une autre installation ou pour restaurer.",
  },
};

export const WELCOME_STEPS: Array<{ title: string; body: string }> = [
  {
    title: 'Bienvenue dans Athena',
    body: 'Athena est un logiciel de comptabilité personnel auto-hébergé. Vos données bancaires ne quittent pas votre réseau.',
  },
  {
    title: 'Créez vos comptes',
    body: 'Commencez par ajouter vos comptes bancaires dans « Comptes ». Le solde de départ et la date d\'ouverture servent de base à tous les calculs.',
  },
  {
    title: 'Importez vos relevés',
    body: 'Depuis « Données › Imports », glissez vos fichiers OFX, CSV ou PDF. Les doublons sont détectés automatiquement.',
  },
  {
    title: 'Analysez vos dépenses',
    body: 'Le tableau de bord affiche votre solde et vos dépenses par catégorie. Définissez ensuite des budgets mensuels si vous le souhaitez.',
  },
];
```

- [ ] **Step 2: Write a smoke test that the file compiles and exports the expected shape**

Create `frontend/src/tips/__tests__/content.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the smoke test**

Run: `npm --prefix frontend run test -- --run frontend/src/tips/__tests__/content.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/tips
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
    commit -m "$(cat <<'EOF'
feat(frontend): tips content registry (TIP_IDS, SECTION_TIPS, WELCOME_STEPS)

Single source of French copy for the first-visit tips system.
Kept in lock-step with the backend TIP_IDS allow-list via a Vitest
alignment test (added in the next commit).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Registry-alignment test (backend reads frontend)

**Files:**
- Create: `backend/tests/tips-registry-alignment.test.ts`

**Interfaces:**
- Consumes: `TIP_IDS` from `backend/src/http/routes/tips/tip-ids.ts`; the source string of `frontend/src/tips/content.ts` read via `fs`.
- Produces: a Vitest test that fails if either `TIP_IDS` array drifts from the other.

- [ ] **Step 1: Write the alignment test**

Create `backend/tests/tips-registry-alignment.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TIP_IDS } from '../src/http/routes/tips/tip-ids.js';

// This test guarantees that the frontend and backend agree on the set
// and order of tip ids. If they drift, either side would happily let
// through a malformed value; the frontend would then try to dismiss a
// tip the backend rejects (400), or vice versa.
describe('tips TIP_IDS backend/frontend alignment', () => {
  it('frontend TIP_IDS array equals backend TIP_IDS array', () => {
    const frontendPath = resolve(
      __dirname,
      '..',
      '..',
      'frontend',
      'src',
      'tips',
      'content.ts',
    );
    const src = readFileSync(frontendPath, 'utf-8');

    // Extract the array literal between `export const TIP_IDS = [` and `] as const;`
    const match = src.match(/export const TIP_IDS\s*=\s*\[([\s\S]*?)\]\s*as const;/);
    expect(match, 'TIP_IDS export not found in frontend/src/tips/content.ts').not.toBeNull();

    const items = match![1]
      .split(/,/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => s.replace(/^['"]|['"]$/g, ''));

    expect(items).toEqual([...TIP_IDS]);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npm --prefix backend run test -- --run backend/tests/tips-registry-alignment.test.ts`

Expected: PASS. This test does not require `RUN_DB_TESTS=1` — it only reads files.

- [ ] **Step 3: Deliberately break the alignment and verify the test catches it**

Temporarily reorder or remove one entry in `frontend/src/tips/content.ts`'s `TIP_IDS`, then re-run:

Run: `npm --prefix backend run test -- --run backend/tests/tips-registry-alignment.test.ts`

Expected: FAIL with a helpful diff. Revert the change; re-run; expected PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/tips-registry-alignment.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
    commit -m "$(cat <<'EOF'
test(backend): assert frontend/backend TIP_IDS arrays are identical

Reads frontend/src/tips/content.ts and parses out the TIP_IDS literal,
then compares to the backend const. Guarantees the frozen id list never
silently drifts between the two projects.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `TipsContext` (React context + hydration)

**Files:**
- Create: `frontend/src/contexts/TipsContext.tsx`
- Create: `frontend/src/contexts/__tests__/TipsContext.test.tsx`
- Modify: `frontend/src/App.tsx` (wrap the authenticated `<Routes>` in `<TipsProvider>` — done here rather than in Task 6 so subsequent frontend tasks can rely on it)

**Interfaces:**
- Consumes: `api` client from `frontend/src/api/client.ts`; `TipId` from `frontend/src/tips/content.ts`.
- Produces:
  ```ts
  interface TipsContextValue {
    dismissed: Record<string, string>;
    isDismissed: (id: TipId) => boolean;
    dismiss:    (id: TipId) => Promise<void>;
    undismiss:  (id: TipId) => Promise<void>;
    reset:      () => Promise<void>;
    ready: boolean;
  }
  export function useTips(): TipsContextValue;
  export function TipsProvider({ children }: { children: ReactNode }): JSX.Element;
  ```

- [ ] **Step 1: Write failing tests for `TipsProvider`**

Create `frontend/src/contexts/__tests__/TipsContext.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { TipsProvider, useTips } from '../TipsContext';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const wrapper = ({ children }: { children: ReactNode }) => (
  <TipsProvider>{children}</TipsProvider>
);

beforeEach(() => {
  fetchMock.mockReset();
});

describe('TipsProvider', () => {
  it('hydrates dismissed ids on mount and exposes ready=true', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ dismissed: { welcome_tour: '2026-07-16T00:00:00.000Z' } }),
    });
    const { result } = renderHook(() => useTips(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.isDismissed('welcome_tour')).toBe(true);
    expect(result.current.isDismissed('section:dashboard')).toBe(false);
  });

  it('dismiss() optimistically updates then POSTs', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ dismissed: {} }) })
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => ({}) });
    const { result } = renderHook(() => useTips(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.dismiss('section:budgets');
    });
    expect(result.current.isDismissed('section:budgets')).toBe(true);
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/tips/dismiss',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('dismiss() rolls back on server error', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ dismissed: {} }) })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    const { result } = renderHook(() => useTips(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await expect(result.current.dismiss('section:dashboard')).rejects.toBeTruthy();
    });
    expect(result.current.isDismissed('section:dashboard')).toBe(false);
  });

  it('reset() clears state and POSTs /reset', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ dismissed: { welcome_tour: 'x', 'section:budgets': 'y' } }),
      })
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => ({}) });
    const { result } = renderHook(() => useTips(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.reset();
    });
    expect(result.current.dismissed).toEqual({});
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/tips/reset',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('useTips() throws when used outside provider', () => {
    // Suppress the expected error boundary noise.
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useTips())).toThrow(/TipsProvider/);
    err.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix frontend run test -- --run frontend/src/contexts/__tests__/TipsContext.test.tsx`

Expected: FAIL (file `../TipsContext` not found).

- [ ] **Step 3: Implement `TipsContext`**

Create `frontend/src/contexts/TipsContext.tsx`:

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from '../api/client';
import type { TipId } from '../tips/content';

interface TipsContextValue {
  dismissed: Record<string, string>;
  isDismissed: (id: TipId) => boolean;
  dismiss: (id: TipId) => Promise<void>;
  undismiss: (id: TipId) => Promise<void>;
  reset: () => Promise<void>;
  ready: boolean;
}

const TipsCtx = createContext<TipsContextValue | null>(null);

export function useTips(): TipsContextValue {
  const ctx = useContext(TipsCtx);
  if (!ctx) throw new Error('useTips() must be used inside <TipsProvider>');
  return ctx;
}

// Fails closed on network errors: if hydration errors we still set ready
// to true with dismissed={}, so the UI does not stall on a broken
// endpoint. The next mutation will attempt to re-sync via its own POST.
export function TipsProvider({ children }: { children: ReactNode }) {
  const [dismissed, setDismissed] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<{ dismissed: Record<string, string> }>('/api/tips/dismissed');
        if (!cancelled) setDismissed(res.dismissed ?? {});
      } catch {
        // Fail closed — see comment above.
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = useCallback(async (id: TipId) => {
    const prev = dismissed;
    setDismissed({ ...prev, [id]: new Date().toISOString() });
    try {
      await api('/api/tips/dismiss', { method: 'POST', body: JSON.stringify({ id }) });
    } catch (err) {
      setDismissed(prev);
      throw err;
    }
  }, [dismissed]);

  const undismiss = useCallback(async (id: TipId) => {
    const prev = dismissed;
    const next = { ...prev };
    delete next[id];
    setDismissed(next);
    try {
      await api('/api/tips/undismiss', { method: 'POST', body: JSON.stringify({ id }) });
    } catch (err) {
      setDismissed(prev);
      throw err;
    }
  }, [dismissed]);

  const reset = useCallback(async () => {
    const prev = dismissed;
    setDismissed({});
    try {
      await api('/api/tips/reset', { method: 'POST' });
    } catch (err) {
      setDismissed(prev);
      throw err;
    }
  }, [dismissed]);

  const value = useMemo<TipsContextValue>(
    () => ({
      dismissed,
      isDismissed: (id) => id in dismissed,
      dismiss,
      undismiss,
      reset,
      ready,
    }),
    [dismissed, ready, dismiss, undismiss, reset],
  );

  return <TipsCtx.Provider value={value}>{children}</TipsCtx.Provider>;
}
```

Adjust the exact `api()` call signatures to match `frontend/src/api/client.ts` (inspect it and update `method`, header shape, `body` handling as needed). The test doubles above stub `fetch` directly, so the `api` wrapper must ultimately call `fetch` with the URL as the first argument for the assertions to match; if your `api` wrapper uses a different signature, adapt the test expectations to match its real call — the intent is that a POST to `/api/tips/dismiss` reaches `fetch`.

- [ ] **Step 4: Wrap the authenticated app in `<TipsProvider>`**

In `frontend/src/App.tsx`:

Add the import near the top (with the other context imports if any, else near the component imports):

```tsx
import { TipsProvider } from './contexts/TipsContext';
```

Wrap the authenticated `<Routes>` block. Replace the final `return ( <Routes> … </Routes> );` block for the authenticated branch with:

```tsx
return (
  <TipsProvider>
    <Routes>
      {/* … unchanged … */}
    </Routes>
  </TipsProvider>
);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm --prefix frontend run test -- --run frontend/src/contexts/__tests__/TipsContext.test.tsx`

Expected: PASS.

- [ ] **Step 6: Run the full frontend suite for regressions**

Run: `npm --prefix frontend run test`

Expected: no regressions.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/contexts/TipsContext.tsx \
        frontend/src/contexts/__tests__/TipsContext.test.tsx \
        frontend/src/App.tsx
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
    commit -m "$(cat <<'EOF'
feat(frontend): TipsContext (hydrate + dismiss/undismiss/reset)

Mirrors the PrivacyContext pattern. Optimistic mutations with rollback
on error, fail-closed on hydration error (ready flips to true with
empty state so UI never stalls on a broken endpoint).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `<WelcomeTour />` component and App-level mount

**Files:**
- Create: `frontend/src/components/WelcomeTour.tsx`
- Create: `frontend/src/components/__tests__/WelcomeTour.test.tsx`
- Modify: `frontend/src/App.tsx` (mount `<WelcomeTour />` inside `<Layout>` element children — see Step 4)

**Interfaces:**
- Consumes: `useTips` from Task 5; `WELCOME_STEPS` from Task 3.
- Produces:
  ```tsx
  export function WelcomeTour(): JSX.Element | null;
  ```
  Renders `null` unless: `ready && !isDismissed('welcome_tour') && location.pathname === '/'`.

- [ ] **Step 1: Write failing tests**

Create `frontend/src/components/__tests__/WelcomeTour.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { TipsProvider } from '../../contexts/TipsContext';
import { WelcomeTour } from '../WelcomeTour';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TipsProvider>
        <Routes>
          <Route path="/" element={<WelcomeTour />} />
          <Route path="*" element={<WelcomeTour />} />
        </Routes>
      </TipsProvider>
    </MemoryRouter>,
  );
}

describe('<WelcomeTour />', () => {
  it('renders nothing while TipsContext is not ready', () => {
    fetchMock.mockImplementation(() => new Promise(() => {})); // never resolves
    renderAt('/');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders on `/` when welcome_tour is not dismissed', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ dismissed: {} }),
    });
    renderAt('/');
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    expect(screen.getByText(/Bienvenue dans Athena/)).toBeTruthy();
  });

  it('does not render on non-root routes even if not dismissed', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ dismissed: {} }),
    });
    renderAt('/transactions');
    // Give hydration a beat.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not render when welcome_tour is already dismissed', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ dismissed: { welcome_tour: 'x' } }),
    });
    renderAt('/');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('clicking Terminer on the last step dismisses welcome_tour', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ dismissed: {} }) })
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => ({}) });
    renderAt('/');
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    // Advance to the last step
    // (WELCOME_STEPS has 4 steps, so click Suivant 3 times).
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByRole('button', { name: /Suivant/ }));
    }
    fireEvent.click(screen.getByRole('button', { name: /Terminer/ }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/tips/dismiss',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('clicking Passer dismisses welcome_tour', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ dismissed: {} }) })
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => ({}) });
    renderAt('/');
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Passer/ }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/tips/dismiss',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix frontend run test -- --run frontend/src/components/__tests__/WelcomeTour.test.tsx`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `<WelcomeTour />`**

Create `frontend/src/components/WelcomeTour.tsx`:

```tsx
import { useState, useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useTips } from '../contexts/TipsContext';
import { WELCOME_STEPS } from '../tips/content';

export function WelcomeTour() {
  const { ready, isDismissed, dismiss } = useTips();
  const location = useLocation();
  const [step, setStep] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);

  const shouldShow = ready && !isDismissed('welcome_tour') && location.pathname === '/';

  const close = useCallback(() => {
    dismiss('welcome_tour').catch(() => {
      // Toast is handled at the context layer if needed.
    });
  }, [dismiss]);

  useEffect(() => {
    if (!shouldShow) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shouldShow, close]);

  useEffect(() => {
    if (shouldShow) dialogRef.current?.focus();
  }, [shouldShow]);

  if (!shouldShow) return null;

  const current = WELCOME_STEPS[step];
  const isLast = step === WELCOME_STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={close}
      aria-hidden={false}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-tour-title"
        ref={dialogRef}
        tabIndex={-1}
        className="max-w-md w-[92%] rounded-lg bg-white p-6 shadow-xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-xs text-slate-500 mb-2">
          Étape {step + 1} / {WELCOME_STEPS.length}
        </div>
        <h2 id="welcome-tour-title" className="text-lg font-semibold mb-2">
          {current.title}
        </h2>
        <p className="text-sm text-slate-700 mb-6">{current.body}</p>
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={close}
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            Passer
          </button>
          {isLast ? (
            <button
              type="button"
              onClick={close}
              className="px-4 py-2 rounded bg-slate-900 text-white text-sm"
            >
              Terminer
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              className="px-4 py-2 rounded bg-slate-900 text-white text-sm"
            >
              Suivant
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

Adjust class names to match the project's existing Tailwind conventions — the block above uses generic Tailwind that should work with the existing setup; if the project uses a different token scheme (e.g. custom colour tokens visible in `Layout.tsx`), reuse those.

- [ ] **Step 4: Mount `<WelcomeTour />` at App root**

In `frontend/src/App.tsx`, inside the authenticated branch's `<TipsProvider>` wrapper (from Task 5), add `<WelcomeTour />` as a sibling of `<Routes>`:

```tsx
import { WelcomeTour } from './components/WelcomeTour';

// …
return (
  <TipsProvider>
    <WelcomeTour />
    <Routes>{/* … */}</Routes>
  </TipsProvider>
);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix frontend run test -- --run frontend/src/components/__tests__/WelcomeTour.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/WelcomeTour.tsx \
        frontend/src/components/__tests__/WelcomeTour.test.tsx \
        frontend/src/App.tsx
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
    commit -m "$(cat <<'EOF'
feat(frontend): <WelcomeTour /> — first-launch modal on '/'

3–4-step modal that opens once for authenticated users landing on
Dashboard when welcome_tour is not yet dismissed. Passer, Terminer,
Escape and backdrop click all call dismiss('welcome_tour').

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `<SectionTip />` component

**Files:**
- Create: `frontend/src/components/SectionTip.tsx`
- Create: `frontend/src/components/__tests__/SectionTip.test.tsx`

**Interfaces:**
- Consumes: `useTips` from Task 5; `SECTION_TIPS` from Task 3.
- Produces:
  ```tsx
  export function SectionTip({ id }: { id: Exclude<TipId, 'welcome_tour'> }): JSX.Element | null;
  ```

- [ ] **Step 1: Write failing tests**

Create `frontend/src/components/__tests__/SectionTip.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { TipsProvider } from '../../contexts/TipsContext';
import { SectionTip } from '../SectionTip';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
});

describe('<SectionTip />', () => {
  it('renders the tip title + body when not dismissed', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ dismissed: {} }),
    });
    render(
      <TipsProvider>
        <SectionTip id="section:dashboard" />
      </TipsProvider>,
    );
    await waitFor(() => expect(screen.getByText(/tableau de bord/i)).toBeTruthy());
  });

  it('renders null when the id is already dismissed', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ dismissed: { 'section:dashboard': 'x' } }),
    });
    render(
      <TipsProvider>
        <SectionTip id="section:dashboard" />
      </TipsProvider>,
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText(/tableau de bord/i)).toBeNull();
  });

  it('clicking the close button dismisses the tip', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ dismissed: {} }) })
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => ({}) });
    render(
      <TipsProvider>
        <SectionTip id="section:budgets" />
      </TipsProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText(/Masquer ce conseil/)).toBeTruthy());
    fireEvent.click(screen.getByLabelText(/Masquer ce conseil/));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/tips/dismiss',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix frontend run test -- --run frontend/src/components/__tests__/SectionTip.test.tsx`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `<SectionTip />`**

Create `frontend/src/components/SectionTip.tsx`:

```tsx
import { useTips } from '../contexts/TipsContext';
import { SECTION_TIPS, type TipId } from '../tips/content';

type SectionTipId = Exclude<TipId, 'welcome_tour'>;

export function SectionTip({ id }: { id: SectionTipId }) {
  const { ready, isDismissed, dismiss } = useTips();
  if (!ready || isDismissed(id)) return null;
  const { title, body } = SECTION_TIPS[id];
  return (
    <section
      aria-labelledby={`tip-${id}`}
      className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 flex items-start gap-3"
    >
      <div className="flex-1">
        <h3 id={`tip-${id}`} className="text-sm font-medium text-slate-900">
          {title}
        </h3>
        <p className="text-sm text-slate-600 mt-1">{body}</p>
      </div>
      <button
        type="button"
        aria-label="Masquer ce conseil"
        onClick={() => {
          dismiss(id).catch(() => {});
        }}
        className="text-slate-400 hover:text-slate-600 text-lg leading-none"
      >
        ×
      </button>
    </section>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix frontend run test -- --run frontend/src/components/__tests__/SectionTip.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/SectionTip.tsx \
        frontend/src/components/__tests__/SectionTip.test.tsx
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
    commit -m "$(cat <<'EOF'
feat(frontend): <SectionTip id=\"…\" /> — inline first-visit tip card

Small inline card at the top of a page; renders null once the id is
dismissed. Close (×) button dismisses via TipsContext.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `<SectionTipHelpIcon />` + Layout header slot

**Files:**
- Create: `frontend/src/components/SectionTipHelpIcon.tsx`
- Create: `frontend/src/components/__tests__/SectionTipHelpIcon.test.tsx`
- Modify: `frontend/src/components/Layout.tsx` (add a small header slot next to the page title that renders `<SectionTipHelpIcon />` when the current route has a known section id)

**Interfaces:**
- Consumes: `useTips`; a mapping from `location.pathname` → section id.
- Produces:
  ```tsx
  export function SectionTipHelpIcon({ id }: { id: Exclude<TipId, 'welcome_tour'> }): JSX.Element | null;
  ```
  Renders `null` unless the id is dismissed; a `<button>` with `aria-label="Réafficher le conseil de cette section"` otherwise.

- [ ] **Step 1: Write failing tests**

Create `frontend/src/components/__tests__/SectionTipHelpIcon.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { TipsProvider } from '../../contexts/TipsContext';
import { SectionTipHelpIcon } from '../SectionTipHelpIcon';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
});

describe('<SectionTipHelpIcon />', () => {
  it('renders nothing when the section tip is NOT dismissed', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ dismissed: {} }),
    });
    render(
      <TipsProvider>
        <SectionTipHelpIcon id="section:budgets" />
      </TipsProvider>,
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders a button when the section tip IS dismissed and calls undismiss on click', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ dismissed: { 'section:budgets': 'x' } }),
      })
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => ({}) });
    render(
      <TipsProvider>
        <SectionTipHelpIcon id="section:budgets" />
      </TipsProvider>,
    );
    await waitFor(() => expect(screen.getByRole('button')).toBeTruthy());
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/tips/undismiss',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix frontend run test -- --run frontend/src/components/__tests__/SectionTipHelpIcon.test.tsx`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `<SectionTipHelpIcon />`**

Create `frontend/src/components/SectionTipHelpIcon.tsx`:

```tsx
import { useTips } from '../contexts/TipsContext';
import type { TipId } from '../tips/content';

type SectionTipId = Exclude<TipId, 'welcome_tour'>;

export function SectionTipHelpIcon({ id }: { id: SectionTipId }) {
  const { ready, isDismissed, undismiss } = useTips();
  if (!ready || !isDismissed(id)) return null;
  return (
    <button
      type="button"
      aria-label="Réafficher le conseil de cette section"
      onClick={() => {
        undismiss(id).catch(() => {});
      }}
      className="ml-2 inline-flex items-center justify-center w-5 h-5 rounded-full border border-slate-300 text-slate-500 text-xs hover:text-slate-700 hover:border-slate-400"
    >
      ?
    </button>
  );
}
```

- [ ] **Step 4: Wire the icon into `Layout.tsx`**

Open `frontend/src/components/Layout.tsx` and inspect how the page title is rendered. Do NOT invent a new API — find where the current section title (e.g. "Tableau de bord", "Transactions", "Budgets") is rendered and add `<SectionTipHelpIcon id={idForCurrentRoute} />` immediately after it. Use a small pathname → id map colocated in `Layout.tsx`:

```tsx
import { SectionTipHelpIcon } from './SectionTipHelpIcon';
import type { TipId } from '../tips/content';

const PATH_TO_TIP_ID: Array<[RegExp, Exclude<TipId, 'welcome_tour'>]> = [
  [/^\/$/, 'section:dashboard'],
  [/^\/transactions/, 'section:transactions'],
  [/^\/budgets/, 'section:budgets'],
  [/^\/regles(\/|$)/, 'section:rules'],
  [/^\/comptes(\/|$)/, 'section:accounts'],
  [/^\/donnees\/imports(\/|$)/, 'section:imports'],
  [/^\/donnees\/sauvegarde(\/|$)/, 'section:data'],
];

function idForPath(pathname: string) {
  for (const [re, id] of PATH_TO_TIP_ID) if (re.test(pathname)) return id;
  return null;
}
```

Where the page title is rendered (search for the JSX that shows the current tab title — likely uses `useLocation()` already, or maps a route to a French label), do:

```tsx
const location = useLocation();
const tipId = idForPath(location.pathname);
// … existing title JSX …
{tipId && <SectionTipHelpIcon id={tipId} />}
```

If `Layout.tsx` does not currently render a page title (only the sidebar/topbar navigation), then instead mount the help icon inside each page's own header in Task 9 — see the note at the top of Task 9.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix frontend run test -- --run frontend/src/components/__tests__/SectionTipHelpIcon.test.tsx`

Expected: PASS.

- [ ] **Step 6: Run the full frontend suite**

Run: `npm --prefix frontend run test`

Expected: no regressions.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/SectionTipHelpIcon.tsx \
        frontend/src/components/__tests__/SectionTipHelpIcon.test.tsx \
        frontend/src/components/Layout.tsx
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
    commit -m "$(cat <<'EOF'
feat(frontend): <SectionTipHelpIcon /> in Layout header for tip replay

Small (?) button appearing next to the current section title only once
that section's tip has been dismissed; click calls undismiss(id) to
re-show it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Mount `<SectionTip />` in each of the seven pages

**Files (each modified):**
- `frontend/src/pages/Dashboard/index.tsx` — insert `<SectionTip id="section:dashboard" />` at the top of the main content.
- `frontend/src/pages/Transactions/index.tsx` — `<SectionTip id="section:transactions" />`.
- `frontend/src/pages/Budgets/index.tsx` — `<SectionTip id="section:budgets" />`.
- `frontend/src/pages/Rules/Tri.tsx` — `<SectionTip id="section:rules" />`.
- `frontend/src/pages/Accounts/index.tsx` — `<SectionTip id="section:accounts" />`.
- `frontend/src/pages/Data/Imports.tsx` — `<SectionTip id="section:imports" />`.
- `frontend/src/pages/Data/Backup.tsx` — `<SectionTip id="section:data" />`.

Also touch existing page-level tests as needed (the SectionTip renders `null` in tests unless the TipsContext is provided, so unless a test wraps a page in `<TipsProvider>` explicitly it should still pass).

If Task 8's Layout header check found no title slot in `Layout.tsx`, add a small header row at the top of each of these files: `<h1>{pageTitle}</h1> <SectionTipHelpIcon id="…" />` followed by `<SectionTip id="…" />`. Otherwise, only insert `<SectionTip id="…" />`.

**Interfaces:**
- Consumes: `SectionTip` from Task 7.
- Produces: no new exports; each page now renders a first-visit tip.

- [ ] **Step 1: For each of the seven pages, add the import and the JSX**

For each page in the list above, at the top of the file:

```tsx
import { SectionTip } from '../../components/SectionTip';
```

(Adjust the relative path per file — `../../components/SectionTip` for two-deep pages, `../../../components/SectionTip` for the `Data/` and `Rules/` files, etc.)

Then insert `<SectionTip id="section:xxx" />` as the very first child of the page's outermost `<div>` / fragment, so it appears above the existing hero. Example diff for Dashboard (illustrative — real file will differ):

```tsx
export function Dashboard() {
  return (
    <>
+     <SectionTip id="section:dashboard" />
      {/* existing hero, chart, donut, … */}
    </>
  );
}
```

- [ ] **Step 2: Run existing page tests to verify no regressions**

Run: `npm --prefix frontend run test`

Expected: all existing page tests still pass. Any test that renders a page WITHOUT wrapping in `TipsProvider` will still pass because `useTips` inside `SectionTip` throws — but the throw happens only if the component actually renders. Since `SectionTip` calls `useTips()` unconditionally, the throw WILL happen. Fix by adjusting each affected page test to wrap in a `TipsProvider` with a mocked fetch, OR add a `TipsProvider` at the test's render root. Use a small local helper in a shared test util:

Create (if not already present) `frontend/src/test/renderWithProviders.tsx`:

```tsx
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { TipsProvider } from '../contexts/TipsContext';

export function renderWithTips(ui: ReactElement) {
  return render(<TipsProvider>{ui}</TipsProvider>);
}
```

Update every failing page test to swap `render(<Page />)` for `renderWithTips(<Page />)`, and to stub `fetch` at the top of the test file so `TipsProvider` hydration resolves:

```ts
const fetchMock = vi.fn().mockResolvedValue({
  ok: true, status: 200, json: async () => ({ dismissed: {} }),
});
vi.stubGlobal('fetch', fetchMock);
```

Alternatively, if the page test already stubs `fetch` for its own API calls, simply add the `/api/tips/dismissed` route to the stub's URL matcher.

- [ ] **Step 3: Run the frontend suite once more**

Run: `npm --prefix frontend run test`

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages frontend/src/test
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
    commit -m "$(cat <<'EOF'
feat(frontend): mount <SectionTip /> on the 7 main sections

Dashboard, Transactions, Budgets, Rules (Tri tab), Comptes, Données ›
Imports, Données › Sauvegarde. Updated page-level tests to render
inside <TipsProvider> with a stubbed hydration endpoint.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: "Rejouer la visite guidée" button in Settings

**Files:**
- Modify: `frontend/src/pages/Settings.tsx` (add a small section with one button)
- Create: `frontend/src/pages/__tests__/Settings.tips-replay.test.tsx`

**Interfaces:**
- Consumes: `useTips().reset` from Task 5.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/__tests__/Settings.tips-replay.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TipsProvider } from '../../contexts/TipsContext';
import { Settings } from '../Settings';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const confirmSpy = vi.spyOn(window, 'confirm');

beforeEach(() => {
  fetchMock.mockReset();
  confirmSpy.mockReset();
});

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TipsProvider>
          <Settings />
        </TipsProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('Settings — tips replay', () => {
  it('shows a "Rejouer la visite guidée" button', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    render(wrap());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Rejouer la visite guidée/i })).toBeTruthy()
    );
  });

  it('calls /api/tips/reset after confirm', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    confirmSpy.mockReturnValue(true);
    render(wrap());
    const button = await screen.findByRole('button', { name: /Rejouer la visite guidée/i });
    fireEvent.click(button);
    await waitFor(() => {
      const called = fetchMock.mock.calls.some(
        ([url, opts]) => url === '/api/tips/reset' && opts?.method === 'POST',
      );
      expect(called).toBe(true);
    });
  });

  it('does nothing if the user cancels the confirm', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    confirmSpy.mockReturnValue(false);
    render(wrap());
    const button = await screen.findByRole('button', { name: /Rejouer la visite guidée/i });
    fireEvent.click(button);
    await new Promise((r) => setTimeout(r, 30));
    const called = fetchMock.mock.calls.some(
      ([url]) => url === '/api/tips/reset',
    );
    expect(called).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix frontend run test -- --run frontend/src/pages/__tests__/Settings.tips-replay.test.tsx`

Expected: FAIL — button not present.

- [ ] **Step 3: Add the button to `Settings.tsx`**

Open `frontend/src/pages/Settings.tsx`. Add the import:

```tsx
import { useTips } from '../contexts/TipsContext';
```

Add a small block near the bottom of the settings form, before the closing outermost element:

```tsx
{(() => {
  const { reset } = useTips();
  return (
    <section className="mt-8 border-t border-slate-200 pt-6">
      <h2 className="text-sm font-semibold text-slate-900 mb-2">Aide</h2>
      <button
        type="button"
        onClick={() => {
          if (window.confirm('Réafficher tous les conseils de première visite ?')) {
            reset().catch(() => {});
          }
        }}
        className="text-sm text-slate-700 underline"
      >
        Rejouer la visite guidée
      </button>
    </section>
  );
})()}
```

(Adapt the wrapper — if `Settings` already uses hooks at its top level, hoist `const { reset } = useTips();` to the component body rather than the IIFE above.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --prefix frontend run test -- --run frontend/src/pages/__tests__/Settings.tips-replay.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Settings.tsx \
        frontend/src/pages/__tests__/Settings.tips-replay.test.tsx
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
    commit -m "$(cat <<'EOF'
feat(frontend): 'Rejouer la visite guidée' button in Réglages

One-click reset of every dismissed tip (tour + all 7 sections),
gated behind a French window.confirm.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Final integration verification

**Files:**
- No new files. Manual smoke check + full suite runs.

**Interfaces:**
- Consumes: everything.
- Produces: green suite + confirmed live behaviour.

- [ ] **Step 1: Run the full backend suite**

Run: `RUN_DB_TESTS=1 npm --prefix backend run test`

Expected: green.

- [ ] **Step 2: Run the full frontend suite**

Run: `npm --prefix frontend run test`

Expected: green.

- [ ] **Step 3: Manual smoke check (LAN-only Geekom deployment)**

Per the project deployment rule (no cloud, runs on the user's mini-PC), verify against the local instance:

1. Log in as an existing user.
2. Open the dashboard: welcome tour appears if this is a fresh install, otherwise expected to be dismissed already. If a re-check is needed, run: `psql … -c "UPDATE user_settings SET dismissed_tips = '{}'::jsonb WHERE user_id = <id>"` on the deployment DB and reload.
3. Walk through all 4 tour steps → Terminer → refresh page: no tour re-appears.
4. Visit each of the 7 sections in turn, verify the section tip appears, dismiss it, verify it does not reappear on a refresh.
5. Notice the (?) icon in each section's header after dismissal; click it, confirm the tip reappears.
6. Go to Réglages → "Rejouer la visite guidée" → confirm; return to Dashboard → tour reappears; visit each section → tip reappears.
7. Break connectivity between browser and backend (e.g. stop the backend container) and dismiss a tip: expect the tip to reappear (rollback) after the failed POST.

Note: do NOT launch OrbStack or any container runtime to perform this test — verify what you can with the running stack and defer any live checks that require the runtime.

- [ ] **Step 4: Grep for public-safe issues before pushing**

Run: `git log --pretty=format:'%H %s' origin/main..HEAD`
Run: `git diff origin/main..HEAD | grep -iE '(secret|password|token|10\.|192\.168|172\.16|geekom|localhost)' || echo 'no obvious leaks'`

Expected: no matches (or only fully expected matches like `passwordHash` in schema code, not real secrets). Fix or split any offending commit before pushing.

- [ ] **Step 5: Stop here**

Do not push. Per the project rule ("push only when asked"), let the user drive the push.

---

## Self-Review

**1. Spec coverage.** Every spec requirement maps to a task:
- Persistence (JSONB column) — Task 1.
- Backend `/api/tips` (GET, dismiss, undismiss, reset) — Task 2.
- Registry-alignment guarantee — Task 4.
- `TipsContext` (hydrate + optimistic mutations + `ready`) — Task 5.
- `<WelcomeTour />` (route-gated, 3-4 steps, Passer/Terminer/Escape/backdrop = dismiss, `role=dialog`) — Task 6.
- `<SectionTip id="…" />` (renders `null` when dismissed, close × button, `aria-labelledby`) — Task 7.
- `<SectionTipHelpIcon />` in Layout header (visible only when dismissed, calls `undismiss(id)`) — Task 8.
- Mount `<SectionTip />` on all 7 pages — Task 9.
- "Rejouer la visite guidée" in Réglages (with French confirm) — Task 10.
- Edge cases (two tabs, server error rollback, pre-migration users, privacy blur, unknown-id rejection) — covered in Tasks 2 and 5.
- Accessibility (`role="dialog"`, `aria-modal`, focus trap, ESC, labelled section, real `<button>` for the (?) icon) — Task 6 and Task 7.
- Testing (real-DB backend tests, RTL frontend tests, registry alignment) — Tasks 2, 4, 5, 6, 7, 8, 10.

**2. Placeholder scan.** No "TBD" / "TODO" left in step content. Two spots defer to a small piece of runtime inspection ("adjust the exact `api()` call signatures", "adapt class names to project conventions") but each includes the concrete code to start from and the reason to check — not a placeholder for missing logic.

**3. Type consistency.** `TipId` is the type of `TIP_IDS[number]` in both `backend/src/http/routes/tips/tip-ids.ts` and `frontend/src/tips/content.ts`. `SectionTipId = Exclude<TipId, 'welcome_tour'>` is used consistently by `SectionTip` and `SectionTipHelpIcon`. `TipsContextValue` shape defined in Task 5 is referenced verbatim in Tasks 6, 7, 8, 10. Endpoint names and payload shapes are copied verbatim between the backend handler code (Task 2) and the frontend `api(...)` calls (Task 5).

**4. Scope check.** All ten implementation tasks belong to one deliverable — the tips system. No unrelated refactoring is included.
