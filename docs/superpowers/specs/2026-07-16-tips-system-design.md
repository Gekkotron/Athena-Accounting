# Tips system — first-launch tour and per-section first-visit tips

**Date:** 2026-07-16
**Status:** Design approved, pending implementation plan
**Owner:** Gekkotron

## Summary

Add a lightweight in-app tips system that helps a new user get their bearings:

1. A **welcome tour** — a small modal with 3–4 steps, shown once the very
   first time an authenticated user lands on the Dashboard.
2. **Per-section first-visit tips** — one small inline card at the top of
   each main page (Dashboard, Imports, Transactions, Rules, Budgets,
   Accounts, Data), shown until the user closes it.

Dismissal is persisted **server-side, per user**, so tips do not resurface
after clearing browser storage or switching browser/device.

Users can replay dismissed tips two ways:

- A "Rejouer la visite guidée" button in Réglages resets **all** tips
  (tour + every section).
- A discreet **(?) icon** in each section header re-shows that single
  section's tip.

## Motivation

The project is being polished for a public open-source release. First
impressions matter: the app is dense (imports, PDF template wizard, rules
engine, splits, checkpoints, budgets, MCP), and there is currently no
in-product orientation. A one-time tour plus small contextual tips give
new users a starting point without adding docs to read.

The system is deliberately minimal — no coach-mark spotlight, no
version-based "what's new" tips, no analytics. See **Non-goals** below.

## Non-goals

- Internationalisation. Copy is French-only, matching the rest of the app.
- Coach-mark / spotlight overlays that point at specific UI elements —
  brittle to redesigns.
- Version-based "what's new" tips. Separate feature if ever wanted.
- Per-tip usage analytics. The app is LAN-only self-hosted; no telemetry
  anywhere.
- Tip ordering / priority. One tip per screen; the welcome tour is a
  single fixed sequence.
- Real-time cross-tab sync of dismissals (see **Edge cases**).

## Architecture

Three layers.

### 1. Persistence

A single new column on the existing `user_settings` table:

```sql
ALTER TABLE user_settings
  ADD COLUMN dismissed_tips JSONB NOT NULL DEFAULT '{}'::jsonb;
```

Migration file: `backend/src/db/migrations/0021_dismissed_tips.sql`.

Drizzle schema addition in `backend/src/db/schema.ts`:

```ts
dismissedTips: jsonb('dismissed_tips')
  .$type<Record<string, string>>()
  .notNull()
  .default({}),
```

**Value shape** — flat object, tip id → ISO-8601 dismissal timestamp.
Missing key means "not yet dismissed".

```json
{
  "welcome_tour":         "2026-07-16T09:12:03.412Z",
  "section:dashboard":    "2026-07-16T09:12:40.001Z",
  "section:imports":      "2026-07-16T09:14:22.777Z",
  "section:transactions": "…",
  "section:rules":        "…",
  "section:budgets":      "…",
  "section:accounts":     "…",
  "section:data":         "…"
}
```

Storing a timestamp instead of a bool costs nothing and preserves a free
audit trail (useful if we ever add "re-show tips changed after date X").

**Frozen tip id allow-list:**

- `welcome_tour`
- `section:dashboard`
- `section:imports`
- `section:transactions`
- `section:rules`
- `section:budgets`
- `section:accounts`
- `section:data`

Any id sent by the client that isn't in this list is rejected `400`,
preventing a buggy or compromised client from polluting the JSONB blob.

### 2. Backend HTTP

New route file `backend/src/http/routes/tips/index.ts`, registered from
`server.ts` next to the other routes. All endpoints are session-auth'd
(same plugin as the rest of the app) and act on the current user only.

```
GET  /api/tips/dismissed             → 200 { dismissed: Record<string, string> }
POST /api/tips/dismiss    { id }     → 204
POST /api/tips/undismiss  { id }     → 204
POST /api/tips/reset                 → 204
```

**Shared allow-list** — a single `TIP_IDS` constant used both by the Zod
schemas and by the SQL handlers. Body validation for `dismiss` /
`undismiss` is `{ id: z.enum(TIP_IDS) }`. Unknown id → `400 { error:
'unknown_tip_id' }`, column untouched.

**Handler behaviour:**

- `dismiss` merges the id into the JSONB with the current timestamp,
  upserting the row so it works even if the user has no `user_settings`
  row yet:

  ```sql
  INSERT INTO user_settings (user_id, dismissed_tips)
  VALUES ($user_id, jsonb_build_object($id, NOW()::text))
  ON CONFLICT (user_id) DO UPDATE
     SET dismissed_tips =
       user_settings.dismissed_tips || jsonb_build_object($id, NOW()::text);
  ```

  Idempotent — dismissing twice overwrites the timestamp.

- `undismiss` removes the key:

  ```sql
  UPDATE user_settings
     SET dismissed_tips = dismissed_tips - $id
   WHERE user_id = $user_id;
  ```

- `reset` clears the whole blob:

  ```sql
  UPDATE user_settings SET dismissed_tips = '{}'::jsonb WHERE user_id = $user_id;
  ```

- `GET /dismissed` returns whatever is stored, or `{}` if the row does
  not exist yet.

- `undismiss` and `reset` are no-ops when the row does not exist
  (nothing to remove) and return `204`.

**Backend tests** (real DB per project rule against mocking the DB):

- `GET /dismissed` returns `{}` for a fresh user.
- `POST /dismiss` then `GET /dismissed` reflects the id with a recent ISO
  timestamp.
- `POST /dismiss` with an unknown id → 400; column unchanged.
- `POST /undismiss` after a dismiss removes the key; column reads `{}`.
- `POST /reset` after several dismisses clears the blob.
- Unauthenticated requests → 401 on all four endpoints.

### 3. Frontend

Mirrors the existing `PrivacyContext` shape.

**`frontend/src/tips/content.ts`** — single registry, all copy in French:

```ts
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
  'section:dashboard':    { title: '…', body: '…' },
  'section:imports':      { title: '…', body: '…' },
  'section:transactions': { title: '…', body: '…' },
  'section:rules':        { title: '…', body: '…' },
  'section:budgets':      { title: '…', body: '…' },
  'section:accounts':     { title: '…', body: '…' },
  'section:data':         { title: '…', body: '…' },
};

export const WELCOME_STEPS: Array<{ title: string; body: string }> = [
  { title: 'Bienvenue dans Athena', body: '…' },
  // 3–4 steps total; exact copy defined during implementation
];
```

Copy for each tip is written during implementation from the sections of
the README's Features list. It is short — one sentence of orientation and
one concrete action.

**`frontend/src/contexts/TipsContext.tsx`**:

```ts
interface TipsContextValue {
  dismissed: Record<string, string>;   // tip id -> ISO
  isDismissed: (id: TipId) => boolean;
  dismiss:    (id: TipId) => Promise<void>;
  undismiss:  (id: TipId) => Promise<void>;
  reset:      () => Promise<void>;
  ready: boolean;                       // true once GET /api/tips/dismissed resolved
}
```

- On mount, calls `GET /api/tips/dismissed` and stores the result. Sets
  `ready = true` when the response resolves (or on error, so tips fail
  closed — we do not want a network glitch to spam the tour).
- `dismiss(id)` optimistically updates local state, then POSTs; on
  failure rolls back and shows a toast.
- `undismiss(id)` and `reset()` follow the same optimistic pattern.
- Provider is wrapped around the authenticated app in `App.tsx`, next to
  `PrivacyProvider`.
- Until `ready === true`, `<WelcomeTour />` and `<SectionTip />` render
  `null` — prevents a flash of the tour before hydration completes.

**`frontend/src/components/WelcomeTour.tsx`** — modal, mounted once at
App root:

- Opens only when **all** of the following hold:
  - `ready === true`
  - `!isDismissed('welcome_tour')`
  - user is authenticated
  - the current route matches the app's authenticated home path (the
    same route that a fresh login redirects to — Dashboard `/`). Not
    `/login`, not the first-run onboarding route.
- Steps come from `WELCOME_STEPS`. Buttons: `[Passer]` and
  `[Suivant] / [Terminer]` on the last step.
- Both `Passer` and `Terminer` call `dismiss('welcome_tour')` — no
  partial completion state.
- Escape and backdrop click are equivalent to `Passer`.
- `role="dialog"`, `aria-modal="true"`, `aria-labelledby` on the step
  title, focus trapped inside the modal, focus returned to `<body>` on
  close.

**`frontend/src/components/SectionTip.tsx`** — inline card:

```tsx
<SectionTip id="section:dashboard" />
```

- Reads title/body from `SECTION_TIPS[id]`; the id is the whole contract
  from the consumer's side.
- Renders `null` if `isDismissed(id)`.
- Sits at the top of each page's main content, above the existing
  hero/cards. Does not steal focus or auto-scroll.
- Close (×) button in the top-right calls `dismiss(id)`.
- Semantically a `<section aria-labelledby="tip-<id>">` with the title
  as the labelled element; the close button carries
  `aria-label="Masquer ce conseil"`.

**(?) icon in section headers** — small icon slot added to `Layout.tsx`'s
header, next to each page title. Rendered as a real `<button>` with
`aria-label="Réafficher le conseil de cette section"`. Only visible when
`isDismissed(currentSectionId)` — otherwise the tip is already on-screen
and the icon would duplicate it. On click, calls `undismiss(id)`.

**"Rejouer la visite guidée" in Settings** — one row in Réglages, single
button. On click, `window.confirm('Réafficher tous les conseils de
première visite ?')`; on OK, call `reset()`. No new dialog component
introduced; matches the plainness of the rest of Réglages.

## Data flow

Fresh install of the app, first user:

1. First-run onboarding creates the user (Argon2id password). The
   `user_settings` row for the new user has `dismissed_tips = '{}'` by
   default.
2. User logs in, `App.tsx` mounts `TipsProvider`, which fires
   `GET /api/tips/dismissed`. Response `{}`, `ready = true`.
3. Router lands the user on Dashboard. `<WelcomeTour />` sees no
   dismissal, opens.
4. User clicks through steps and taps `Terminer`. Optimistic:
   `dismissed.welcome_tour = <ISO now>`. Server POST succeeds.
5. `<SectionTip id="section:dashboard" />` renders because no dismissal
   exists for it. User reads it, clicks the ×. Optimistic dismiss + POST.
6. User navigates to Imports. `<SectionTip id="section:imports" />`
   renders. Same flow.
7. Subsequent visits to any section: `isDismissed(id)` returns `true`, so
   `<SectionTip />` renders `null`, and the (?) icon appears in the header.

Returning user (all tips previously dismissed):

- `GET /dismissed` returns the stored blob; `ready = true`; no tour, no
  inline cards. Every section header shows its (?) icon.

Replay path via Réglages:

- User taps "Rejouer la visite guidée" → confirm → `reset()` clears
  server + local. Next Dashboard mount reopens the tour; every section
  card reappears.

Replay path via (?) icon:

- User taps the (?) next to a section title → `undismiss(id)` removes
  that single key. The `<SectionTip />` for that page renders on the very
  next state change (optimistic update triggers a re-render).

## Edge cases

- **Two tabs open, dismiss in tab A.** Tab B still shows the tip until
  reloaded. Acceptable — no realtime sync elsewhere in the app; adding
  one for this is not worth it. Tab B's next mount re-hydrates and the
  tip disappears.
- **Server error on any mutation.** Optimistic state rolls back; toast in
  French, e.g. `"Impossible d'enregistrer le conseil comme masqué."`
  User can retry.
- **User created before the migration.** `dismissed_tips` defaults to
  `'{}'`. Existing users therefore see the tour on their next login
  after deploy — this is intentional (they get the same orientation
  benefit as new users) and mentioned in the release notes.
- **Privacy blur on when tour opens.** Blur applies to the app
  underneath the modal, not to the modal itself. Tip copy contains no
  amounts.
- **Client sends a stale/unknown tip id after a future removal.** Handler
  returns `400`; the frontend logs a warning and treats it as a no-op.
  Removing an id from the allow-list also requires clearing that key
  from the JSONB blob in a follow-up migration — noted in
  **Migration/rollout**.

## Accessibility

- Welcome tour modal: `role="dialog"`, `aria-modal="true"`,
  `aria-labelledby` on the current step title, focus trap while open,
  Esc to close, focus returned to previously focused element.
- Section tip: `<section aria-labelledby="tip-<id>">`; close button
  `aria-label="Masquer ce conseil"`.
- (?) icon: real `<button>`, `aria-label="Réafficher le conseil de cette
  section"`. Colour uses the same muted-foreground token as other
  secondary chrome, contrast checked against light and dark themes.

## Testing

**Backend** (real DB, Vitest, matches existing route test style):

- `GET /api/tips/dismissed` empty for fresh user.
- `POST /api/tips/dismiss` known id → 204; subsequent GET reflects it
  with a recent ISO timestamp.
- `POST /api/tips/dismiss` unknown id → 400; column unchanged.
- `POST /api/tips/undismiss` known id → 204; GET no longer contains the
  key.
- `POST /api/tips/reset` → 204; GET returns `{}`.
- All four endpoints unauthenticated → 401.

**Frontend** (Vitest + React Testing Library, matches
`frontend/src/pages/__tests__/`):

- `TipsProvider` hydrates from the endpoint and exposes `ready`.
- `<WelcomeTour />` does not render until `ready === true`.
- `<WelcomeTour />` skips render once `welcome_tour` is dismissed.
- `<SectionTip id="…" />` renders when the id is not dismissed; hides
  after the close button is clicked; calls `dismiss(id)` with the right
  id.
- Settings "Rejouer" button, after confirm, calls `reset()`.
- (?) icon: hidden while the section's tip is on-screen; visible once
  dismissed; click calls `undismiss(id)` and the tip reappears.
- **Registry alignment test:** the frontend `TIP_IDS` array literally
  equals the backend's `TIP_IDS`. Achieved by importing a shared
  constant if `packages/shared` (or an equivalent) exists in the repo at
  implementation time; otherwise both files import from a single JSON
  under `backend/src/db/` and the frontend test asserts equality.
  Concrete choice is nailed down in the implementation plan.

## Migration and rollout

- One migration file: `0021_dismissed_tips.sql`. `ADD COLUMN … DEFAULT
  '{}'::jsonb NOT NULL`. Safe on an in-use table because Postgres treats
  the default as a metadata-only rewrite for JSONB defaults on modern
  versions — but the app is LAN-only single-user, so this consideration
  is theoretical.
- No data backfill needed: the default handles existing rows.
- Removing a tip id in the future requires (a) removing it from the
  allow-list on both sides and (b) a follow-up migration that strips the
  key from `dismissed_tips` for every row (`UPDATE user_settings SET
  dismissed_tips = dismissed_tips - 'old_id'`). Not applicable to the
  initial ship.

## Public-safe review

Per the project's public-safe commits rule: no IPs, hostnames, or
secrets appear in this design or in the code it implies. Tip copy is
generic orientation text, no personal data or LAN specifics.
