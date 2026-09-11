# Notification System — Design

**Date:** 2026-09-01
**Status:** Design approved, awaiting implementation plan
**Author:** Gekkotron

## Purpose

Alert the user in-app and on the OS about accounting events that matter — a
large transaction landing, an account dropping below a floor, a budget
envelope blown, or a bank-sync failure — without exposing amounts or
merchant names on notification surfaces that a shoulder-surfer can see.

## Scope

**In scope.** In-app inbox with unread state, transient toasts, native OS
notifications through the Tauri shell, and browser Web Notifications for
plain-browser access. Four trigger kinds: `big_transaction`,
`account_low`, `envelope_exceeded`, `bank_sync_failed`. Per-user
preferences: master switch, per-channel toggles, privacy mode (hide
amount / hide merchant), per-trigger enable + per-account thresholds.
Batching of trigger bursts into a single summary notification.

**Out of scope.** Email / SMTP delivery. Push through a third-party FCM
or APNs relay. Notification snoozing / quiet hours. Any cloud dependency
— the app remains LAN-only self-hosted.

## Approach

Server-driven pipeline with a persisted queue and one Server-Sent Events
stream that fans out to three client channel adapters (toast, Tauri OS,
Web Notifications). The persisted row is the source of truth so the
inbox survives reload and desktop restarts; the SSE stream keeps the
client live without polling; the same event payload feeds all three
outbound channels.

Two alternatives considered and rejected: poll-only (inbox never feels
live, OS notifications lag by the poll interval) and client-only with no
persistence (loses notifications the user was offline for — defeats the
use case).

## Data model

New table `notifications` (Drizzle, added to `backend/src/db/schema.ts`):

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `user_id` | uuid | fk → users |
| `kind` | text | `big_transaction` \| `account_low` \| `envelope_exceeded` \| `bank_sync_failed` \| `test` |
| `payload` | jsonb | typed per kind; see below |
| `read_at` | timestamptz null | |
| `created_at` | timestamptz | default `now()` |
| `idempotency` | text | e.g. `low:${accountId}:${YYYY-MM-DD}` |

Indexes: `(user_id, created_at desc)` for inbox listing; unique
`(user_id, idempotency)` so `insert … on conflict do nothing` dedupes
retries and same-day recurrences.

Payload shapes (typed in `shared/api-contracts.ts`):

- `big_transaction` — single: `{ txId, accountId, amount, merchant }`
  · summary: `{ accountId, count, total }`
- `account_low` — `{ accountId, balance, floor }`
- `envelope_exceeded` — `{ categoryId, envelope, spent, month }`
- `bank_sync_failed` — `{ accountId, reason }`
- `test` — `{ }` (only used by the settings "Send a test" button)

## Preferences

Preferences live inside the existing `user_settings.settings` JSONB —
no new column. Add a `notifications` sub-object to `SettingsSchema` in
`backend/src/domain/settings/schema.ts`, with defaults added to
`defaults.ts`:

```ts
notifications: {
  enabled: boolean,                              // master kill switch
  channels: {
    toast: boolean,
    osNative: boolean,
    webPush: boolean,
  },
  privacy: {
    hideAmount: boolean,
    hideMerchant: boolean,
  },
  triggers: {
    bigTransaction:   { enabled: boolean, thresholds: Record<accountId, number> },
    accountLow:       { enabled: boolean, floors:     Record<accountId, number> },
    envelopeExceeded: { enabled: boolean },
    bankSyncFailed:   { enabled: boolean },
  },
}
```

Defaults: `enabled: true`, `toast: true`, `osNative: false` (user opts
in), `webPush: false`, both privacy flags `true` (privacy-safe by
default), all four triggers enabled, thresholds/floors empty (a missing
entry means the trigger doesn't fire for that account until the user
configures one). The in-app inbox is always available when `enabled` is
true — it isn't a channel toggle, since disabling it would leave stored
rows unreachable.

## Emission

New module `backend/src/domain/notifications/`:

- `bus.ts` — module-scoped `Map<userId, Set<subscriber>>`. Not exported
  outside the module. `subscribe(userId, cb)` / `unsubscribe`.
- `emit.ts` — `emitNotification(userId, kind, payload, opts?: { idempotency?, batchKey? })`.
  Loads prefs, short-circuits on master or trigger disable, otherwise
  persists (`insert … on conflict do nothing`) and broadcasts to the bus.
- `batcher.ts` — per-`(userId, batchKey)` buffer. Flushes at whichever
  comes first: 2s idle, 10 items, or an explicit `flushBatch(userId, batchKey)`
  call. Batch flush writes one summary row and one bus event.
- `render.ts` — pure `renderTitle(kind, payload, privacy)` and
  `renderBody(...)`. Privacy toggles applied here so the wire payload
  for OS / Web-Push is already redacted.

Call sites (four, each a one-line call from domain code):

| Trigger | Call site | Notes |
|---|---|---|
| `big_transaction` | `domain/imports/commitImport.ts` and direct transaction insert routes | Per-row `batchKey: bt:${accountId}` folds bursts into `{count, total}`. |
| `account_low` | Same insert path after balance recompute + at end of bank sync | Idempotency `low:${accountId}:${YYYY-MM-DD}` — fires at most once per account per day, even after recover-and-dip. |
| `envelope_exceeded` | Inline helper after transaction insert; matches on tx.categoryId | Idempotency `env:${categoryId}:${YYYY-MM}`. |
| `bank_sync_failed` | `domain/bank-sync/` on error or `needs_reconnect` | Idempotency `sync:${accountId}:${YYYY-MM-DD}`. |

Batcher is in-memory only. Acceptable because the deployment is a
single Fastify node on a LAN mini-PC; worst case of a mid-flush crash
is a couple of individual notifications rather than one summary, and
the underlying transactions are already committed.

## Delivery to client

**SSE endpoint** `GET /api/notifications/stream`
(`backend/src/http/routes/notifications/stream.ts`):

- Guarded by existing `requireAuth`.
- Emits `retry: 15000` on connect, `event: ping` every 25s.
- Per event payload = notification row + pre-rendered `title` / `body`
  strings already privacy-redacted.
- On connect, replays unread rows from the last 60s so reconnect gaps
  don't lose events; the inbox `GET /api/notifications` remains the
  source of truth for older items.
- On client disconnect, `bus.unsubscribe(userId, cb)`.

**Frontend transport** `frontend/src/lib/notifications/stream.ts`:

- Single `EventSource` created once at app mount, closed on logout,
  reopened on login.
- On message: (a) invalidate the `['notifications', 'inbox']` react-query
  key so the bell + inbox refetch, (b) hand the event to each enabled
  channel adapter.
- Auto-reconnect is native to EventSource — no custom retry wiring.

**Channel adapters** under `frontend/src/lib/notifications/channels/`:

1. `toast.ts` — always on if `channels.toast`. Renders through the
   existing UI toast primitive if one is already in use; if not, adds a
   minimal Tailwind-styled `frontend/src/components/Toast.tsx` as part
   of the implementation. Full detail; never privacy-redacted.
2. `osNative.ts` — active only inside the Tauri shell (detected via
   `window.__TAURI__`). Calls `tauri-plugin-notification`'s
   `sendNotification({ title, body })` with the redacted strings. Adds
   the plugin to `desktop/src-tauri/Cargo.toml` and to
   `capabilities/default.json` — first-time setup.
3. `webPush.ts` — active only in plain browsers. `Notification.requestPermission()`
   fires only when the user explicitly enables the Browser channel
   toggle in Settings — never on first load. `new Notification(title, { body, tag: notification.id })`
   on each event; `tag` dedupes if the same event arrives twice.

Privacy toggles apply to `osNative` and `webPush` only. The in-app
inbox always shows full detail — the shoulder-surfer story doesn't
apply once the user has opened the app.

## Frontend UX

**Header bell** — new `frontend/src/components/NotificationBell.tsx`,
mounted in the existing app-shell header. Unread badge sourced from
`useNotifications({ unread: true })`. Click opens a popover with the
last ~10 unread items and a "See all" link. Row click marks-read and
deep-links (transaction detail, account, settings for
`bank_sync_failed`).

**Inbox page** — `frontend/src/pages/Notifications/index.tsx`, route
`/notifications`:

- Full history, most-recent first. Virtualize only if it becomes slow;
  a self-hosted user is unlikely to accumulate thousands.
- Grouped by day (`Today`, `Yesterday`, then dates) — matches the
  Transactions page.
- Per-row: kind icon, title, body, relative time, read/unread dot,
  hover-reveal "Mark read / Delete".
- Header: "Mark all as read", filter chips
  (`All | Unread | Big tx | Account low | Envelope | Bank sync`).
- Empty state: "No notifications yet. Configure alerts in
  Settings → Notifications."

**Settings sub-page** —
`frontend/src/pages/Settings/SettingsNotifications.tsx`, wired into
`Settings.tsx`:

1. Master switch — "Enable notifications".
2. Channels — Toasts, OS notifications (visible only inside Tauri),
   Browser notifications (visible only in browser; permission grant on
   enable, shows current permission state). The in-app inbox is not a
   channel toggle — it is always available while notifications are
   enabled.
3. Privacy — "Hide amounts", "Hide merchant names", with the hint
   "Applies only to OS and browser notifications. In-app always shows
   full detail."
4. Triggers — four collapsible cards:
   - *Big transaction* — per-account threshold table; inputs use
     text + `inputMode="decimal"` + `parseDecimal` (never
     `<input type="number">` per project convention).
   - *Account low* — per-account floor, same input pattern.
   - *Envelope exceeded* — enable toggle only.
   - *Bank sync failed* — enable toggle only.
5. Test button — "Send a test notification". Fires a synthetic `test`-kind
   event through the full pipeline (persists a row, broadcasts on the
   bus, exercises all enabled channels). Confirms the pipeline works
   end-to-end with the user's current settings.

All strings via `react-i18next`, new `notifications` namespace in the
locale files.

## API surface

New file `backend/src/http/routes/notifications/index.ts` registers:

- `GET  /api/notifications` — list, params `unread`, `kind`, `limit`, `cursor`.
- `GET  /api/notifications/unread-count` — for the bell badge.
- `POST /api/notifications/:id/read` — mark one read.
- `POST /api/notifications/read-all` — mark all read.
- `DELETE /api/notifications/:id` — remove.
- `POST /api/notifications/test` — fire the synthetic test event.
- `GET  /api/notifications/stream` — SSE (see Delivery).

All routes gated by `requireAuth`.

## Testing

**Backend unit** (`backend/tests/…`):

- `notifications/emit.test.ts` — respects master switch, respects
  per-trigger toggles, `on conflict do nothing` prevents double-insert
  on retry.
- `notifications/batcher.test.ts` — flushes at 2s idle, at 10 items,
  and on explicit `flushBatch`. Fake timers.
- `notifications/render.test.ts` — `hideAmount` strips the currency
  string, `hideMerchant` strips the counterparty, inbox path never
  redacts.
- `routes/notifications.test.ts` — CRUD, auth guard, unread-count.
  DB-integration file, gated on `RUN_DB_TESTS=1` (skips cleanly on the
  laptop, matches project convention).

**Backend integration**:

- `notifications-stream.test.ts` — Fastify inject harness against the
  SSE endpoint: subscribe, emit, assert delivered event, assert
  `unsubscribe` on client disconnect.

**Frontend unit** (Vitest):

- `NotificationBell.test.tsx` — badge count, popover open/close, mark-read on click.
- `SettingsNotifications.test.tsx` — master toggle disables children,
  per-account inputs use `parseDecimal`, `requestPermission` fires only
  on explicit browser-channel enable.
- `stream.test.ts` — EventSource mock, verify each channel adapter
  fires exactly when its channel is enabled, verify redacted strings
  match the payload.

**E2E** (`frontend/e2e-fullstack/`):

- One happy path — import a CSV containing a transaction above the
  configured threshold, assert an inbox row appears and a toast is
  visible. No real OS notification assertion (Playwright can't do it
  reliably), no real bank sync (existing fake-fetch pattern applies).

**Manual verification checklist** (Playwright cannot cover OS-level
notifications):

- Desktop shell: enable OS notifications, hit "Send a test", confirm
  the macOS / Windows / Linux banner shows the redacted text.
- Browser: enable Browser notifications, grant permission, hit "Send
  a test", confirm the browser notification shows the redacted text.

## Migration

Single Drizzle migration adds the `notifications` table. No backfill —
existing rows in `user_settings.settings` without a `notifications`
sub-object receive the defaults through `mergeSettings`, which already
merges `DEFAULTS ← stored ← patch`.

## Risks and open questions

- **Batcher lives in memory.** Acceptable at this deployment scale; a
  crash costs at most 2s of unflushed grouping, not data. Revisit if
  the app ever grows a second node.
- **SSE through the Tauri sidecar.** The 25s ping keeps the channel
  alive through any intermediary; if a specific proxy still closes the
  stream, EventSource's native reconnect handles it and the 60s
  replay-on-connect covers the gap.
- **`account_low` idempotency window is a full day.** By design: one
  notification per account per day. If the user prefers "fire again
  after recover then re-dip", flip the idempotency key to a rolling
  window instead — trivial change, deferred until asked for.
