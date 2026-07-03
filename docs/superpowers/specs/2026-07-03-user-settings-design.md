# User-configurable settings — design

_Draft: 2026-07-03_

## Goal

Give the user a place to set the defaults that currently sit in code
(`dashboard.range = '3m'`, `dashboard.chartScope = 'all'`,
`MAX_SOLID_GAP_DAYS = 6`, `dup.similarityThreshold = 0`), persisted per
user in the database so the same account picks up the same defaults on
any browser.

Non-goal for v1: a general-purpose theming / locale / privacy-timeout
surface. The JSONB shape below leaves room to grow, but this spec ships
only the four values above.

## Storage

New Postgres table, one row per user:

```sql
-- backend/src/db/migrations/0013_user_settings.sql
CREATE TABLE user_settings (
  user_id     integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  settings    jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
```

JSONB (rather than one column per field) so adding future settings does
not require a schema migration each time. `ON DELETE CASCADE` on
`user_id` cleans up rows when a user is deleted.

Drizzle schema entry alongside, mirroring the pattern in
`backend/src/db/schema.ts` for existing tables.

## Shape

Zod is the source of truth for the shape and bounds, on the backend:

```ts
// backend/src/domain/settings/schema.ts
export const SettingsSchema = z.object({
  dashboardRange: z.enum(['30d', '3m', '6m', '12m', 'all']).optional(),
  dashboardChartScope: z
    .union([z.literal('all'), z.number().int().positive()])
    .optional(),
  chartGapThresholdDays: z.number().int().min(1).max(60).optional(),
  duplicateSimilarityThreshold: z.number().int().min(0).max(100).optional(),
});
export type Settings = z.infer<typeof SettingsSchema>;
```

Every field optional so the client can PATCH partials.

Defaults live in `backend/src/domain/settings/defaults.ts` and
`frontend/src/lib/settings.ts` (five lines each). The **backend is the
source of truth** — its defaults are what `GET /api/settings` returns
for a user with no row. The frontend `DEFAULTS` is a paint-safe
fallback used only until the initial `GET` resolves (~tens of ms). If
the two drift, the backend value wins the moment the query lands, so
drift is cosmetic at worst. A brief cross-referencing comment on each
side ("keep in sync with backend/src/domain/settings/defaults.ts")
signals the coupling to future readers.

```ts
export const DEFAULTS = {
  dashboardRange: '3m',
  dashboardChartScope: 'all',
  chartGapThresholdDays: 6,
  duplicateSimilarityThreshold: 0,
} as const;
```

## API

New file `backend/src/http/routes/settings.ts`:

- `GET /api/settings` → `{ settings: Settings }`
  - Reads the row for `req.session.userId`.
  - Merges stored JSONB over `DEFAULTS`, so any field the user has
    never touched comes back as its default.
  - Sanitises `dashboardChartScope`: if it holds an account id that
    (a) no longer exists or (b) belongs to another user, the response
    silently returns `'all'` for that field. Prevents a dangling FK
    after account deletion or an id leak between users. The stored
    JSONB is not rewritten by GET — only the response is filtered.
- `PATCH /api/settings` → `{ settings: Settings }`
  - Body validated against `SettingsSchema.strict()` (unknown keys →
    400 so a client bug doesn't quietly pollute the JSONB).
  - Upsert on `user_id`, merging the incoming keys into the existing
    row's `settings` (`jsonb || excluded.settings`).
  - Returns the same shape as GET, with the same sanitisation applied.

Both endpoints require `preHandler: app.requireAuth`.

Rate limit: the existing global limit is plenty; no per-route
override.

## Frontend hook

`frontend/src/lib/useSettings.ts`, wrapping React Query:

```ts
export function useSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings'], queryFn: getSettings });
  const mut = useMutation({
    mutationFn: patchSettings,
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ['settings'] });
      const prev = qc.getQueryData<{ settings: Settings }>(['settings']);
      qc.setQueryData(['settings'], {
        settings: { ...(prev?.settings ?? DEFAULTS), ...patch },
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(['settings'], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
  return {
    settings: q.data?.settings ?? DEFAULTS,
    isReady: !q.isLoading,
    patch: mut.mutate,
    mutation: mut,
  };
}
```

Optimistic update, rollback on error, invalidate on settle. Consumers
that mount before the query resolves receive `DEFAULTS` — matches the
"just render with the safe defaults" behaviour the app already has for
first-paint of other queries.

Typed fetch client in `frontend/src/api/settings.ts` (`getSettings`,
`patchSettings`), following `api/checkpoints.ts`.

## Consumers to wire

Three code sites currently persist these values via
`usePersistedState` or as hard-coded constants. All three switch to
`useSettings`:

1. **`frontend/src/pages/Dashboard/index.tsx`** — replaces the two
   `usePersistedState('dashboard.range', …)` and
   `usePersistedState('dashboard.chartScope', …)` calls with plain
   `useState` seeded from `settings.dashboardRange` /
   `settings.dashboardChartScope`. Local `useState` changes made while
   the Dashboard is mounted stay in memory only; navigating away and
   back (or refreshing) unmounts the Dashboard, re-mounts it, and
   reads the setting again. This is a deliberate change: "default"
   now means "what loads on Dashboard mount every time"; the old
   "last-picked survives reloads" behaviour is dropped for these two
   controls, replaced by an explicit setting the user owns.

2. **`frontend/src/components/BalanceChart/index.tsx`** — the
   `MAX_SOLID_GAP_DAYS = 6` constant becomes an optional prop
   `gapThresholdDays?: number` with default `6`, threaded from
   `Dashboard/index.tsx` as
   `<BalanceChart … gapThresholdDays={settings.chartGapThresholdDays} />`.
   Default preserved so existing tests and any hypothetical direct
   caller keep working.

3. **`frontend/src/pages/Imports/DuplicatesPanel.tsx`** — replaces
   `usePersistedState('dup.similarityThreshold', 0)` with `useState`
   seeded from `settings.duplicateSimilarityThreshold`. Same
   "default = mount-time value" semantics as the Dashboard.

The old localStorage keys (`dashboard.range`, `dashboard.chartScope`,
`dup.similarityThreshold`) are left in place, dead. No code reads them
after this change; wiping them from the user's browser is not worth
the ceremony. Noted in `STATUS.md` known deferrals on landing.

## Settings page

New route + page.

- **Route**: `/settings`, added in `App.tsx` next to `/profile`,
  behind the same `Layout` element (auth-guarded).
- **Page**: `frontend/src/pages/Settings.tsx`, structured like
  `Profile.tsx` — single `surface` card, `max-w-xl`, sections divided
  by `border-t border-ink-800/60`.

Sections:

1. **Dashboard**
   - _Période par défaut_ — the existing `<RangePicker>`. `onChange`
     → `patch({ dashboardRange: r })`.
   - _Compte du graphique par défaut_ — `<select>` fed by
     `useQuery(['accounts'])`. First option `Tous les comptes
     ({primaryCurrency})` (value `'all'`), one option per account.
     `onChange` → `patch({ dashboardChartScope: … })`.
   - _Seuil de ligne pointillée (jours)_ — `<input type="number"
     min="1" max="60">`, commits on blur (not on every keystroke, to
     avoid a PATCH storm). Helper: "Un écart supérieur à X jours entre
     deux points est tracé en pointillés."

2. **Imports**
   - _Seuil de similarité par défaut (Possibles doublons)_ —
     `<input type="number" min="0" max="100">` with `%` suffix, commits
     on blur.

3. **Actions**
   - _Réinitialiser aux valeurs par défaut_ — ghost button. Opens the
     existing `<ConfirmDialog>`; on confirm, calls `patch(DEFAULTS)`
     with every field explicitly set. No dedicated `DELETE
     /api/settings` endpoint — the PATCH path already handles it.

Feedback:

- **On success**: a small "Enregistré" chip in the `sage-` palette
  appears next to the touched field for ~1.5 s, driven by
  `mutation.isSuccess` + a `setTimeout` reset.
- **On error**: a red banner at the top of the card in the `clay-`
  palette, matching `Profile.tsx`. The optimistic value is rolled back
  by the hook.
- **While loading (`!isReady`)**: whole card renders a skeleton;
  controls disabled.

## Sidebar wiring

`frontend/src/components/Layout.tsx` `UserCard`:

- Add a tiny `GearIcon` (5-line inline SVG, same shape family as the
  existing `EyeOpenIcon` / `EyeClosedIcon` in the file).
- Change the username row to a `flex items-center justify-between`
  container:
  - Left: unchanged username `NavLink` → `/profile`.
  - Right: icon-only `NavLink` → `/settings`, `title="Réglages"`,
    `aria-label="Réglages"`, `btn-ghost` with tight padding.
- Existing "Masquer les montants" and "Se déconnecter" buttons stay
  untouched below.

## Tests

**Backend** — new `backend/tests/settings.test.ts`, patterned after
`balance-checkpoints.test.ts`:

1. `GET /api/settings` unauthenticated → 401.
2. `GET /api/settings` for a user with no row → returns full defaults.
3. `PATCH /api/settings` with a partial → upserts, returns merged full
   object.
4. `PATCH /api/settings` twice with disjoint patches → second `GET`
   shows the merge, not the last write only.
5. `PATCH /api/settings` with an out-of-range value
   (`chartGapThresholdDays: 999`) → 400.
6. `PATCH /api/settings` with a `dashboardChartScope` pointing to a
   deleted account → next `GET` silently returns `'all'`.
7. `PATCH /api/settings` with a `dashboardChartScope` pointing to
   another user's account → next `GET` silently returns `'all'` for
   the caller.
8. Delete a user → their `user_settings` row is gone (`ON DELETE
   CASCADE`).
9. `PATCH /api/settings` with an unknown key → 400 (strict schema).

**Frontend**:

- `frontend/src/lib/__tests__/useSettings.test.tsx` — with a mocked
  fetch:
  - defaults returned while pending
  - optimistic update visible immediately
  - rollback on mutation error
  - `invalidateQueries` fires `onSettled`
- `frontend/src/pages/__tests__/Settings.test.tsx` (RTL):
  - renders a skeleton while `!isReady`, controls disabled
  - editing the range picker sends a PATCH with the new range
  - number inputs commit on blur, not on every keystroke
  - "Réinitialiser" opens the confirm dialog and, on confirm, sends
    a PATCH with every default value
- `frontend/src/pages/__tests__/Dashboard.test.tsx` — add a case:
  when `settings.dashboardChartScope = 2`, the account `<select>`
  mounts with account 2 pre-selected.
- `frontend/src/components/BalanceChart/__tests__/*.test.tsx` — one
  new case: passing `gapThresholdDays={2}` renders a dotted segment
  where a 3-day gap sits in the data.

No cross-side "defaults parity" test — backend is the source of truth
(see Shape section); frontend `DEFAULTS` only paints the initial ~tens
of ms before the query resolves, so drift self-heals.

## Error handling

- Backend errors → 500 `{ error: 'internal' }` from the existing
  Fastify error handler; no driver messages leak.
- Frontend GET failure → the hook returns `DEFAULTS`, and the
  Settings page shows a subtle "Impossible de charger vos réglages"
  banner. Dashboard / Duplicates panel don't need special-case code —
  they just see defaults.
- Concurrency: two tabs editing simultaneously → last PATCH wins. No
  versioning column. Single self-hosted user, two-tab conflict is a
  non-scenario.

## Explicit non-goals

- No server-side migration of the old localStorage keys into
  `user_settings`. First visit to Réglages sets whatever the user
  wants; the stale keys are harmless.
- No `GET /api/settings/defaults` endpoint. Defaults duplicated
  frontend + backend, guarded by the parity test above.
- No versioning / conflict resolution.
- No settings export/import in v1. Small enough surface that the
  Réglages page suffices.

## Landing plan

1. Migration `0013_user_settings.sql` + Drizzle schema entry.
2. Backend route + backend tests.
3. Frontend `api/settings.ts` + `useSettings` hook + hook tests.
4. Settings page + route + page tests.
5. Sidebar gear entry in `Layout.tsx`.
6. Wire Dashboard + BalanceChart + DuplicatesPanel to `useSettings`.
   Remove the three superseded `usePersistedState` calls in the same
   step. Update the Dashboard and DuplicatesPanel tests.
7. `STATUS.md` update — recently landed + one line under known
   deferrals for the dead localStorage keys.
