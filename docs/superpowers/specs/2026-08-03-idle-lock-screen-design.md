# Idle lock screen — replace the un-authenticated blur privacy mode

**Date:** 2026-08-03
**Status:** approved

## Problem

The current privacy mode (`frontend/src/contexts/PrivacyContext.tsx`) blurs
on-screen amounts after 5 minutes of inactivity by toggling a `privacy-on`
class on `<html>`. It is cosmetic: the amounts remain in the DOM, and the eye
toggle un-blurs with no authentication — anyone at the keyboard can reveal
everything. The backlog carried a "PIN lock for privacy mode" task to fix
this, but a PIN system (set/change/remove flows, server-side storage,
lockout logic) is heavy. Reusing the account password the user already has
gives real protection with a fraction of the surface.

## Decision

Replace the blur-on-idle with a **lock-on-idle**: after the idle timeout the
app shows a full-screen lock overlay, and revealing the app again requires
the account password, verified server-side. App state (session, current
page, filters, form drafts) survives the lock — unlike a full auto-logout,
which was considered and rejected for destroying in-progress state.

## Behavior

- The existing 5-minute idle timer (mousemove/keydown/scroll/touchstart/click,
  frozen while locked) is kept as-is; only the effect changes: it now sets
  `locked` instead of `hidden`.
- **Lock screen**: full-viewport overlay above everything, showing the app
  name, the current username, a password field (submit on Enter), an inline
  error area, and an escape-hatch link (mode-dependent, see below).
- **Eye button** in the layout becomes "lock now": it triggers the same lock
  screen immediately. There is no un-authenticated hide/reveal anymore —
  hidden always means locked.
- **Unlock**: `POST /api/auth/verify { password }`. On 200 the overlay is
  removed and the user is exactly where they left off. On 401 with a session
  still alive, show the "wrong password" inline error. On 429, show the
  rate-limit message. If the session itself expired while idle, the request
  fails as unauthenticated and the existing login-redirect path takes over.
- **Lock persistence**: locking also writes a flag to `localStorage`; the
  provider boots into the locked state whenever the flag is present, and a
  successful unlock clears it. Without this, F5 (LAN) or relaunching the
  desktop app would bypass the lock with a valid session — the same flaw the
  feature exists to fix. Residual, documented gap: the lock is enforced by
  the client, so the API itself stays reachable with the session cookie
  (curl/devtools), and a tab closed *before* the idle timer fires leaves no
  flag behind. Both are outside the "casual person at the keyboard" threat
  model; a server-enforced session lock is explicitly out of scope.
- **Defense in depth**: while locked, the existing `privacy-on` class stays
  applied underneath the overlay so amounts are also visually hidden in the
  layer below it. (Amounts remain in the DOM either way; this feature
  protects against the person at the keyboard, not a devtools attacker —
  that threat model requires logout, which on LAN stays available from the
  lock screen.)
- **"Se déconnecter" link** (session mode only): calls the normal logout,
  landing on the login page — the escape hatch for switching users or a
  forgotten password. In none mode logout is meaningless (the session is
  re-stamped on every request), so the desktop lock screen shows a "Mot de
  passe oublié ?" hint pointing at the documented recovery instead: with
  physical access to the machine, `curl -X POST
  localhost:<port>/api/auth/lock-password/reset` resets the hash to the
  placeholder (none mode only — the route does not exist in session mode).
  A curl-capable intruder could read the unencrypted local DB anyway, so
  this adds no attack surface beyond the existing desktop trust model.
- **Desktop app** (Tauri sidecar, `AUTH_MODE=none`): there is no account
  password — every request is auto-authenticated as the hard-coded `local`
  user whose `passwordHash` is an unverifiable placeholder. The lock is
  therefore **opt-in on desktop**: a "Mot de passe de verrouillage" section
  (visible only in `none` mode) lets the user set, change, or remove a lock
  password. It is argon2-hashed into `users.passwordHash` on the local row,
  replacing the placeholder — no schema change. While no lock password is
  set, the timer never arms and the eye button is hidden; once set, desktop
  behaves exactly like the LAN version (same lock screen, same verify).
- **Demo mode** (`VITE_DEMO` static bundle, no real auth): the idle timer
  never arms and the eye button is hidden. No lock in demo.

## Backend

Four new routes in `backend/src/http/routes/auth.ts`; no new tables, no
schema change:

- `POST /api/auth/verify`
  - `preHandler: app.requireAuth`
  - body: `{ password: z.string().min(1) }` (400 on parse failure)
  - loads the session user, verifies with argon2 (`@node-rs/argon2`, same
    `ARGON2_OPTS`), returns `{ ok: true }` or `401 { error: 'invalid
    credentials' }`. The desktop placeholder hash never verifies, so a
    placeholder row is a plain 401 (unreachable via the UI, which only
    locks when a lock password exists).
  - rate limit: `{ max: 10, timeWindow: '1 minute' }`, same as login
  - no session rotation
- `GET /api/auth/lock-status`
  - `preHandler: app.requireAuth`
  - returns `{ mode: 'session' | 'none', lockConfigured: boolean }` —
    `lockConfigured` is `true` in session mode (the account password is the
    lock), and in none mode iff the local row's hash is not the placeholder.
    The frontend uses this to arm the timer, show/hide the eye button, and
    show the desktop lock-password settings section.
- `PUT /api/auth/lock-password` — none mode only (404 in session mode,
  where the account password already fills this role via `PATCH /api/auth/me`)
  - body: `{ currentPassword?: string, newPassword?: string }`
    - set (placeholder present): `newPassword` only, min 8 chars
    - change: both required, `currentPassword` verified first
    - remove: `currentPassword` only → hash reset to the placeholder
  - rate limit `{ max: 10, timeWindow: '1 minute' }`
- `POST /api/auth/lock-password/reset` — none mode only (404 in session
  mode). No body; resets the local row's hash to the placeholder. The
  documented "forgot my lock password" recovery for the desktop app, where
  no logout/login path exists. Rate-limited like the others.

## Frontend

- `PrivacyContext` evolves into the lock-state holder (rename to
  `LockContext`/`useLock` if that reads better at implementation time — the
  file may keep its path):
  - state: `locked: boolean`
  - `lockNow(): void`
  - `unlock(password: string): Promise<void>` — calls the api client; throws
    typed errors the lock screen maps to messages
  - the no-auth `reveal`/`toggle` are removed
  - the `privacy-on` class mirroring stays, driven by `locked`
- New `LockScreen` component rendered at the Layout level when `locked`:
  password input (`type="password"`), Enter submits, busy state while the
  request is in flight, inline error for 401/429, and the escape-hatch link
  (logout in session mode, "Mot de passe oublié ?" docs hint in none mode).
- Eye button in `components/Layout` switches from `toggle` to `lockNow`.
- The provider fetches `/api/auth/lock-status` once after auth resolves and
  exposes `lockAvailable`; the timer arms and the eye renders only when
  `lockAvailable` is true. In session mode this is always true, so LAN
  behavior is unconditional; on desktop it flips when the user sets or
  removes the lock password (settings mutation invalidates the query).
- Desktop settings UI: a "Mot de passe de verrouillage" card (rendered only
  when `mode === 'none'`) with set / change / remove flows backed by
  `PUT /api/auth/lock-password`. French decimal/input conventions and
  existing Réglages card styles apply.
- New i18n keys, fr + en (lock title, password label, unlock button, wrong
  password, rate-limited, logout link, lock-password settings card).
- Demo (`VITE_DEMO`): the demo stub answers `lock-status` with
  `lockConfigured: false`, so the timer never arms and the eye is hidden —
  no special-casing in components.

## Testing

- Backend (`vitest`, route tests): verify — correct password → 200, wrong →
  401, unauthenticated → 401, malformed body → 400; lock-status in both
  modes (placeholder vs real hash in none mode); lock-password — set when
  placeholder, change with wrong/right current, remove, 404 in session mode.
- Frontend: context tests updated — locks after idle timeout, activity does
  not auto-unlock, `lockNow` locks immediately, boots locked when the
  localStorage flag is present, unlock clears it; `LockScreen` component tests
  — successful unlock removes the overlay, 401 shows the error, logout link
  calls logout; Layout test — eye button locks.

## Docs & planning

- `docs/users/security-and-privacy.md` (+ FR mirror under `website/i18n/…`):
  update the privacy-mode paragraph to describe the password lock, the
  desktop opt-in lock password, and the desktop recovery procedure
  (`lock-password/reset` via curl), with its honest threat-model framing.
- PLAN.md: this spec supersedes the "PIN lock for privacy mode — spec first"
  backlog task; replace it with an implementation task pointing at this
  document.

## Out of scope

- Configurable timeout duration (stays hardcoded at 5 minutes).
- A separate PIN distinct from the account / lock password.
- Hiding amounts from the DOM / API while locked.
- Server-enforced session lock (session `locked` flag + server-side idle
  tracking, API refusing while locked). Considered and deferred: real
  backend complexity, and fragile in desktop `none` mode where the session
  is re-stamped on every request. The localStorage persistence above covers
  the casual-passerby threat model this feature targets.
- Auto-logout timers.
