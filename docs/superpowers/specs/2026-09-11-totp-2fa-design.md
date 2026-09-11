# TOTP 2FA — optional second factor for account login

**Date:** 2026-09-11
**Status:** proposed

## Problem

Login today is a single factor: `POST /api/auth/login` accepts a username +
password, argon2-verifies against `users.password_hash`, and stamps the
session (`backend/src/http/routes/auth.ts:37-68`). Rate-limited to 10 attempts
per IP per minute and timing-stable against user-enumeration, but a leaked or
phished password still means full account takeover — and the LAN-only,
self-hosted deployment model does nothing to change that (a family member who
finds a scribbled password walks straight in from any device on the network).

The app is about to go public with a "flagship" open-source push, so an
optional TOTP second factor is table-stakes for the security-conscious users
who will actually audit the code before running it. Keeping it **optional**
matches the single-user home-server framing — a family running Athena on
LAN with strict physical access already has adequate defence in depth, and
should not be forced through a phone dance every login.

## Decision

Ship TOTP (RFC 6238, HMAC-SHA1, 6 digits, 30-second window) as an **opt-in**
per-user second factor. Enrolment is gated on the current password, secrets
are encrypted at rest with an HKDF-derived key (same pattern as
`backend/src/domain/bank-sync/crypto.ts`), and login becomes a two-step flow
when TOTP is enabled. Ten single-use recovery codes are generated at
enrolment, hashed at rest with argon2, shown once, and can be regenerated
after re-authenticating.

**Scope in v1:** session mode only (`AUTH_MODE=session`). Desktop mode
(`AUTH_MODE=none`) with an idle-lock password is explicitly out of scope for
this iteration — see [Desktop and demo modes](#desktop-and-demo-modes) below.

### Dependency decision — hand-roll TOTP, no new backend dependency

RFC 6238 TOTP is a ~30-line function: HMAC-SHA1 over a big-endian 8-byte
counter (`floor(unixTime / 30)`), dynamic truncation, `code = binary %
10⁶`, zero-pad to 6 chars. `node:crypto`'s `createHmac('sha1', ...)` is all
we need. The codebase already prefers built-ins for security primitives
(argon2 in auth is the one third-party exception, justified because argon2
is not a Node built-in) — see `backend/src/http/routes/backup/crypto.ts`
(scrypt/AES-256-GCM via `node:crypto` only), `backend/src/domain/bank-sync/crypto.ts`
(hkdfSync via `node:crypto` only).

**Compared to `otplib`** (~15 KB minified but pulls `thirty-two` and
`@otplib/plugin-crypto`): equal correctness for our narrow use, more
transitive deps to audit before a public repo push, and covers features we
do not use (HOTP, extended step counts, alternate hash algorithms). Not
worth the dependency for RFC 6238 straight.

**Frontend**: add `qrcode` (~40 KB gz, single-purpose, MIT, no transitive
deps beyond `dijkstrajs` + `pngjs` for its buffer path) to render the QR
client-side from the `otpauth://` URL returned by the backend. Alternative
"just show the base32 secret and skip the QR" is a materially worse UX
(every Aegis / Google Authenticator / 1Password tutorial screenshot shows
QR scan first, manual entry second). Hand-rolling QR encoding is 100+ lines
of Reed-Solomon and matrix layout — not remotely comparable to hand-rolling
TOTP. `qrcode` wins.

## Behavior

- **Enrolment (`Paramètres › Sécurité › Deux facteurs`)**
  1. User clicks **Activer**. A modal asks for the current account password
     (defence against a leaked-session self-lockout — an attacker who owns
     the session cannot silently enrol 2FA with an app *they* control and
     force the real user out).
  2. Backend generates a fresh 160-bit random secret (base32 encoded, 32
     chars, padding stripped), stores it encrypted with `totp_enabled_at`
     still null. Returns the `otpauth://totp/Athena:<username>?secret=<b32>&issuer=Athena&algorithm=SHA1&digits=6&period=30`
     URL and the raw base32 secret (for manual entry).
  3. Frontend renders the QR from the URL and shows the base32 fallback
     underneath. User scans, then types a 6-digit code from their app.
  4. Backend verifies the code against the pending secret (accept the
     current window ±1 for clock skew), generates 10 recovery codes, hashes
     them with argon2, activates (`totp_enabled_at = now()`), returns the
     codes in plaintext **once**.
  5. Frontend shows the 10 codes, a "Download .txt" button, and a "Copy"
     button. User must tick "I have saved my recovery codes" to close the
     modal.
- **Abandoning enrolment**: closing the modal before confirming leaves the
  pending secret in place but not activated. Next enrolment attempt
  overwrites it (there is only one row per user). No timer-based cleanup —
  a pending secret is harmless without activation, and the row is trivially
  wiped by another `Activer` click.
- **Login with 2FA**
  1. `POST /api/auth/login { username, password }` — same as today, but on
     success the response is `{ requiresTotp: true }` (no user object yet)
     and the session is stamped as *half-authenticated* (`session.userId`
     set, `session.totpPending = true`).
  2. Frontend shows a second step: 6-digit input, an "Utiliser un code de
     récupération" link that expands into a longer text field.
  3. `POST /api/auth/2fa/verify { code }` — accepts a 6-digit TOTP or an
     8-char recovery code (dash-stripped). On success: `session.totpPending
     = false`, session is `regenerate()`d to prevent fixation, and the
     `{ user: { id, username } }` response is returned. On failure: 401
     with the same rate-limit bucket as `/login` (10/min per IP).
  4. All routes other than `/api/auth/logout` and `/api/auth/2fa/verify`
     return **401 with `{ error: 'totp required' }`** while `totpPending` is
     true. Enforced in `authPlugin.requireAuth` — one line, hard fail.
- **Disable**
  1. Settings shows "Désactivé" once activated, with a **Désactiver**
     button.
  2. Modal asks for the account password **and** a current TOTP code (or a
     recovery code). Both are required — a leaked password alone must not
     disable 2FA, and a stolen device without the password must not either.
  3. On success: delete the `user_totp` row and all recovery-code rows.
- **Regenerate recovery codes**
  1. Distinct button in the Security card; requires the account password.
  2. Deletes all existing hashes, generates 10 new codes, shows them once
     (same modal flow as enrolment).
- **Session model**: adding `totpPending: boolean` to the session shape.
  `req.session.totpPending` is set to `true` when a password login succeeds
  for a user with an active TOTP row, and cleared on verify success or
  logout. `requireAuth` short-circuits with 401 when `totpPending` is true
  unless the route is on a small allowlist (`/api/auth/2fa/verify`,
  `/api/auth/logout`).

## Backend

### Schema — migration `0041_user_totp.sql`

Separate table (cleaner delete-on-disable than nullable columns on `users`,
and keeps the 2FA rows out of every user-object SELECT):

```sql
CREATE TABLE user_totp (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_ciphertext BYTEA NOT NULL,  -- HKDF+AES-256-GCM envelope, see below
  enabled_at TIMESTAMPTZ,            -- null while pending, set at confirm
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE user_totp_recovery_codes (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,           -- argon2id (same ARGON2_OPTS as passwords)
  used_at TIMESTAMPTZ,               -- null = unused; set when burned
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX user_totp_recovery_codes_user_idx
  ON user_totp_recovery_codes (user_id) WHERE used_at IS NULL;
```

Drizzle mirror added to `backend/src/db/schema.ts`. Backup schema
(`backend/src/http/routes/backup/schema.ts`) does **NOT** include either
table — TOTP is a per-device credential (like a session cookie), not
portable user data. A restore into a different install must re-enrol. This
is documented in `docs/users/security.md` and stated in the disable/regen
modals.

### Secret encryption at rest — `backend/src/domain/auth/totp-crypto.ts`

Mirror the pattern in `backend/src/domain/bank-sync/crypto.ts`:

```ts
import { hkdfSync, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const HKDF_SALT = 'athena-totp-secret';   // fixed, per-install key derivation
const HKDF_INFO = 'totp-secret-v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function key(sessionSecret: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(sessionSecret, 'utf8'),
             Buffer.from(HKDF_SALT), Buffer.from(HKDF_INFO), 32),
  );
}

// Layout: [12-byte IV][16-byte GCM tag][ciphertext]
export function encryptSecret(base32Secret: string, sessionSecret: string): Buffer { … }
export function decryptSecret(envelope: Buffer, sessionSecret: string): string { … }
```

Rotating `SESSION_SECRET` invalidates every enrolled secret (they cannot
decrypt), same as it would invalidate every existing session cookie. That is
the expected behaviour — a documented consequence of the secret-rotation
runbook, not a regression.

### TOTP core — `backend/src/domain/auth/totp.ts`

Pure RFC 6238. ~40 lines total:

```ts
import { createHmac } from 'node:crypto';

const DIGITS = 6;
const PERIOD_S = 30;

export function generateSecretBase32(): string { /* 20 bytes → base32, no padding */ }

export function generateCode(secretBase32: string, atUnixSec = Math.floor(Date.now() / 1000)): string {
  const counter = Math.floor(atUnixSec / PERIOD_S);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const secret = base32Decode(secretBase32);
  const h = createHmac('sha1', secret).update(buf).digest();
  const offset = h[h.length - 1] & 0x0f;
  const binary =
    ((h[offset]     & 0x7f) << 24) |
    ((h[offset + 1] & 0xff) << 16) |
    ((h[offset + 2] & 0xff) <<  8) |
     (h[offset + 3] & 0xff);
  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

export function verifyCode(secretBase32: string, submitted: string, windowSlop = 1): boolean {
  const nowSec = Math.floor(Date.now() / 1000);
  for (let s = -windowSlop; s <= windowSlop; s++) {
    if (timingSafeEqualStr(generateCode(secretBase32, nowSec + s * PERIOD_S), submitted)) return true;
  }
  return false;
}

export function otpauthUrl(username: string, base32Secret: string): string {
  const label = encodeURIComponent(`Athena:${username}`);
  const params = new URLSearchParams({
    secret: base32Secret,
    issuer: 'Athena',
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params}`;
}
```

`base32Decode` and `base32Encode` are the RFC 4648 alphabet, ~20 lines each.
No dependency needed. Constant-time comparison via `crypto.timingSafeEqual`
on equal-length Buffers.

### Routes — new file `backend/src/http/routes/auth/totp.ts`

Register from the existing `authRoutes` in `auth.ts` (rename that file into a
folder if we want; not required — a sibling file is fine and mirrors the
`goals/` split). All routes preHandler `requireAuth`. All state-changing
routes are rate-limited `{ max: 10, timeWindow: '1 minute' }` (login-tier).

- `POST /api/auth/2fa/enroll`
  - body: `{ password: z.string().min(1) }`
  - verify current password (argon2), else 401
  - generate secret, upsert `user_totp` (userId, encryptSecret(secret,
    env.SESSION_SECRET), enabled_at: null)
  - returns `{ secret: <base32>, otpauthUrl: <string> }`
- `POST /api/auth/2fa/confirm`
  - body: `{ code: z.string().regex(/^\d{6}$/) }`
  - loads the pending row; 400 if none or already enabled
  - `verifyCode(decryptSecret(...), code)`; 401 on mismatch
  - transaction: `UPDATE user_totp SET enabled_at = NOW()`; generate 10
    recovery codes (`randomBytes(5)` per code, base32-encoded to 8 chars,
    formatted `xxxx-xxxx`), argon2-hash each, insert into
    `user_totp_recovery_codes`
  - clear `session.totpPending` (defensive — enrolling doesn't set it, but a
    just-in-case)
  - returns `{ recoveryCodes: string[] }` — the only response that ever
    carries them in plaintext
- `POST /api/auth/2fa/verify` — the login-flow completion route
  - preHandler: **`requireAuth` variant that accepts `totpPending: true`**
    (see [requireAuth carve-out](#requireauth-carve-out) below)
  - body: `{ code: z.string().min(6).max(20) }` — accepts either a 6-digit
    TOTP or a recovery code (`xxxx-xxxx`, dash optional on input)
  - if 6 digits: `verifyCode(decryptSecret(...), code)`
  - else: iterate unused recovery codes (`used_at IS NULL`), argon2-verify
    each; on match, `UPDATE user_totp_recovery_codes SET used_at = NOW()
    WHERE id = ?` in the same transaction that clears `totpPending`
  - on success: `req.session.regenerate()` (re-rotate session id — a leaked
    half-auth cookie must not survive full authentication),
    `session.userId = user.id`, `session.username = user.username`,
    `session.totpPending = false`; return `{ user: { id, username } }`
  - on failure: 401 `{ error: 'invalid code' }`, hits the login-tier rate
    limit
- `POST /api/auth/2fa/disable`
  - body: `{ password: z.string().min(1), code: z.string().min(6).max(20) }`
  - verify password; 401 on mismatch
  - verify code (TOTP or recovery, same logic as `/verify`); 401 on mismatch
  - `DELETE FROM user_totp WHERE user_id = ?` (cascade wipes recovery rows)
  - returns `{ ok: true }`
- `POST /api/auth/2fa/regenerate-codes`
  - body: `{ password: z.string().min(1) }`
  - verify password; 401 on mismatch
  - `DELETE FROM user_totp_recovery_codes WHERE user_id = ?`, generate + hash
    + insert 10 fresh codes, return `{ recoveryCodes: string[] }`
- `GET /api/auth/2fa/status`
  - returns `{ enabled: boolean, remainingRecoveryCodes: number }` — the UI
    uses this to render the Security card ("Désactivé" vs "Activé, 7 codes
    de récupération restants")

### `/api/auth/login` — behavioral change

Two lines of change plus a status check:

```ts
// after successful password verify:
const [totpRow] = await db.select().from(userTotp)
  .where(and(eq(userTotp.userId, user.id), isNotNull(userTotp.enabledAt))).limit(1);
if (totpRow) {
  await req.session.regenerate();      // still rotate on first factor success
  req.session.userId = user.id;
  req.session.totpPending = true;
  return { requiresTotp: true };
}
// unchanged path: no TOTP → the current final response
```

### `requireAuth` carve-out

`backend/src/plugins/auth.ts` (wherever `requireAuth` lives — grep for
`app.decorate('requireAuth'`) gains one branch: after the existing
"has userId?" check, if `session.totpPending === true` and the route is
not on the allowlist (`/api/auth/2fa/verify`, `/api/auth/logout`), return
`401 { error: 'totp required' }`. Everything else already works — the
session is stamped, so downstream `req.session.userId` reads still work,
and no route needs to opt into the check.

### Recovery-code format and burn semantics

- 10 codes per user, 8 chars each, RFC 4648 base32 alphabet (no
  ambiguous chars — the RFC's ABCDEFGHIJKLMNOPQRSTUVWXYZ234567 already
  omits 0/O/1/I/L). Rendered as `xxxx-xxxx` for readability, dash stripped
  on server input.
- Argon2id hash at rest (`ARGON2_OPTS` from `auth.ts` — same params as
  passwords, ~10 ms each on the Geekom). Verifying a submitted recovery
  code is O(remaining), i.e. up to 10 argon2 verifies (~100 ms) — an
  acceptable one-off cost for a rare code-of-last-resort operation, and
  it happens under the rate limit.
- One-shot: successful match is transactional with `UPDATE ... SET
  used_at = NOW()` so a replay after the connection drops can't
  double-spend.
- No lockout when all 10 are used — the UI simply shows "0 codes de
  récupération restants" and nags to regenerate. TOTP still works; only
  the recovery path is gone.

### `SESSION_SECRET` requirement (session-mode envs)

Encrypted secrets already require `SESSION_SECRET` for both bank-sync and
sessions themselves. TOTP piggybacks on the same env var — no new secret to
manage. Startup validation in `backend/src/env.ts` already enforces its
presence in session mode.

## Frontend

### New API client — `frontend/src/api/totp.ts`

Thin fetch wrappers mirroring the routes above. Types re-exported from
`shared/api-contracts.ts` (`TotpStatus`, `TotpEnrollResponse`).

### Settings — `frontend/src/pages/Settings/SettingsSecurity.tsx`

Add a `TotpSection` component (kept under 220 LOC per the frontend
max-lines gate — split into `TotpSection.tsx` + `TotpEnrollModal.tsx` +
`TotpRecoveryCodesModal.tsx` if it approaches the cliff).

- Disabled state card: heading, one-line explanation, **Activer** button.
  Button opens `TotpEnrollModal`.
- `TotpEnrollModal`: three-step wizard driven by internal state.
  - Step 1: password field, **Continuer** → POST `/enroll`.
  - Step 2: QR (rendered via `qrcode`), base32 secret in a monospace block,
    6-digit input, **Vérifier** → POST `/confirm`. Inline error area for
    401 or 429.
  - Step 3: 10 recovery codes in a grid, **Copier** and **Télécharger**
    buttons, "J'ai sauvegardé mes codes" checkbox that gates the **Terminer**
    button. Closing the modal without checking still activates 2FA (the
    server has already flipped enabled_at) — the checkbox is a "you were
    warned" UX device, not an atomicity boundary.
- Enabled state card: heading + "Activé, N codes de récupération restants",
  **Régénérer les codes** button, **Désactiver** button. Both prompt for
  password (and code for disable) in a small modal.

### Login flow — `frontend/src/pages/Login/LoginPage.tsx`

Currently a single form. Refactor as a two-step state machine:

- Step 1: username + password, `/api/auth/login`. If response is
  `{ user }` → navigate to `/`. If `{ requiresTotp: true }` → advance to
  step 2.
- Step 2: single 6-digit input (auto-focus, autocomplete=`one-time-code`,
  numeric inputMode), an "Utiliser un code de récupération" link that
  swaps the input for a longer text field. **Se connecter** →
  `/api/auth/2fa/verify`. Error area for wrong-code / rate-limit / expired
  session (redirect back to step 1 in the last case, i.e. any 401 that
  is not "invalid code").
- Escape hatch: a **Se déconnecter** link at the bottom of step 2 that
  hits `/api/auth/logout` (already an allowlisted route) and returns to
  step 1. Handles the "I started a login on the wrong account" case.

### QR rendering

Import `qrcode` in `TotpEnrollModal` only (dynamic import so the login page
doesn't grow). `await QRCode.toDataURL(otpauthUrl, { errorCorrectionLevel:
'M', margin: 1, scale: 6 })` → `<img>` tag. QR shown at ~200 px square.

### i18n

New `frontend/src/locales/{fr,en}/security.json` (or extend the existing
`settings.json` under a `twoFactor.*` namespace — pick whichever matches
the existing security-card key layout; grep before deciding). Every
user-visible string flows through `useTranslation('security')` (or
`settings`), no bare English/French literals in JSX.

## Testing

- **Backend unit** — `backend/src/domain/auth/__tests__/totp.test.ts`
  (in-memory, no DB):
  - `generateCode` vs the RFC 6238 test vectors (Appendix B) — this is the
    correctness anchor for the whole feature.
  - `verifyCode` accepts current window, ±1 window, rejects ±2, rejects
    truncated / non-numeric / extra-digit inputs.
  - `generateSecretBase32` returns 32 chars (160 bits), uses only the RFC
    4648 alphabet.
  - `otpauthUrl` output matches a locked-down snapshot for a fixed
    (username, secret) pair.
  - `encryptSecret` + `decryptSecret` round-trip; wrong session secret
    throws; tampered envelope throws.
- **Backend routes** — `backend/src/http/routes/auth/__tests__/totp-routes.test.ts`
  (PGlite, uses the same harness as goals/notifications tests):
  - `/enroll` requires password, rejects wrong password, idempotent (a
    second enroll replaces the pending secret, never activates without
    confirm).
  - `/confirm` verifies against pending secret only (activated row cannot
    be re-confirmed), 400 if no pending row, activates on success,
    returns 10 recovery codes, argon2-hashes them in storage.
  - `/verify` accepts a fresh TOTP code, rejects an old one, rejects a
    used recovery code, one-shot burns a valid recovery code
    (transactional — spy on `tx.execute` or read `used_at` post-hoc),
    rate-limited to 10/min.
  - `/disable` requires password + code, deletes both tables' rows.
  - `/regenerate-codes` deletes previous rows, returns 10 fresh codes,
    argon2-hashes them.
  - `/status` returns `{ enabled: false, remainingRecoveryCodes: 0 }`
    before enrol, `{ enabled: true, remainingRecoveryCodes: 10 }` after
    confirm, decrements after `/verify` with a recovery code.
- **Backend login integration** — extend
  `backend/src/http/routes/__tests__/auth-route.test.ts`:
  - login with no TOTP → old response shape unchanged (regression guard).
  - login with active TOTP → `{ requiresTotp: true }`, session has
    `totpPending`, subsequent `/api/auth/me` returns 401 with `totp
    required`, `/verify` clears the flag, `/me` succeeds after.
  - a request to any non-allowlisted route while `totpPending` returns 401
    (unit-test `requireAuth` behaviour with a stub route).
- **Frontend unit** — `frontend/src/pages/Settings/__tests__/TotpSection.test.tsx`:
  - Renders disabled state card and "Activer" flow.
  - Enrol modal happy path: password → QR + secret shown → wrong code shows
    error → correct code shows recovery codes.
  - Disable modal requires both password and code.
  - Regenerate replaces the codes shown last time.
- **Frontend login** — extend `LoginPage.test.tsx`:
  - `requiresTotp: true` swaps the form; 6-digit input focuses; recovery
    link toggles to text input; a 401 on `/verify` shows the error inline;
    a session-expired 401 pops back to step 1.
- **Playwright** (`tests/e2e/`) — one new spec `totp-2fa.spec.ts`:
  full enrol → logout → login with TOTP → login with recovery code →
  disable. Uses a fixed clock via `page.clock.install` so the code
  generator matches the server across the run.

## Demo mode and desktop mode

- **Demo (`VITE_DEMO=1`)**: no real auth; the `SettingsSecurity` card
  either hides the TOTP section entirely (preferred — the demo already
  hides other auth-related affordances) or renders a disabled tile with an
  "Available in the self-hosted version" tooltip. Every `/api/auth/2fa/*`
  demo handler is a 501 stub in `frontend/src/api/demo/handlers/auth.ts`.
- **Desktop (`AUTH_MODE=none`)**: the routes 404 in v1 (matches the
  existing `/api/auth/lock-password` pattern). The Security card checks
  `mode` from `/api/auth/lock-status` and hides the TOTP section. Adding
  TOTP as a *second* factor to the desktop lock screen is a plausible
  v1.1, tracked as its own follow-up task rather than smuggled into v1 —
  the flow is different (no username, single local user, unlock-time
  challenge instead of login) and the code-sharing story with session
  mode needs its own design pass.

## Threat model

**Protects against:**
- **Leaked password** (family member finds a scribbled password, dump of a
  reused-password breach, phished password). Without the second factor
  the attacker has nothing; TOTP requires realtime access to the phone.
- **Silent 2FA hijack via a stolen session cookie**. Enrol/disable/regen
  all require the current password, so a cookie alone cannot pivot into
  persistent access.

**Does NOT protect against:**
- **Local machine compromise of the server**. `SESSION_SECRET` decrypts
  every stored TOTP secret; anyone with shell on the Geekom can read them
  all. Same story as bank-sync credentials — documented, unavoidable for
  a self-hosted-with-server-side-secrets design.
- **Realtime phishing / MitM**. TOTP codes are valid for 30 s; a real-time
  proxy can relay them within the window. Session mode with a proper
  HTTPS terminator (nginx) mitigates the MitM; the phishing case is
  outside the LAN threat model.
- **Physical device theft with an unlocked authenticator app**. Same as
  password + phone theft — orthogonal, and out of scope.
- **A server-side login-attempt lockout**. The 10/min rate limit is
  IP-scoped, not account-scoped, and there is no permanent lockout after
  N tries. An attacker on the LAN with 30 s per attempt still gets 10⁶
  possibilities per code and moves on to another IP. If needed later, a
  per-user failed-verify counter and cool-down is a small follow-up task
  — noted below.

## Non-goals for v1

- WebAuthn / hardware keys.
- SMS or email second factors (no phone-book, no outbound mail, and both
  are strictly weaker than TOTP anyway).
- Push notifications to a paired phone app.
- Backup codes stored on a separate server / cloud.
- Per-route MFA (step-up auth on sensitive endpoints).
- Multi-device TOTP (multiple secrets per user — most authenticator apps
  handle this by scanning the QR from two devices at enrolment time; we
  do not need per-secret tracking).

## Follow-up tasks to append to PLAN.md `## Backlog`

Once this spec is approved:

1. **TOTP 2FA — Task 1: backend (schema + core + routes)**
   Migration `0041_user_totp.sql`; `backend/src/domain/auth/totp.ts` +
   `backend/src/domain/auth/totp-crypto.ts` with RFC 6238 test vectors;
   `backend/src/http/routes/auth/totp.ts` with the six routes above; login
   handler in `auth.ts` gains the `requiresTotp` branch; `requireAuth`
   gains the `totpPending` carve-out; wipe route clears both new tables.
   Success criteria: RFC vectors green, all `totp-routes.test.ts` and
   `auth-route.test.ts` green, `cd backend && npx vitest run` green.
2. **TOTP 2FA — Task 2: frontend (Settings + Login + i18n + demo stubs)**
   `TotpSection` under Settings (respect the 300-line gate — split as
   needed); two-step `LoginPage` refactor; `qrcode` frontend dep pinned;
   full FR + EN i18n; demo-mode `/api/auth/2fa/*` handlers as 501s;
   `TotpSection` and `LoginPage` tests. Success criteria:
   `cd frontend && npx vitest run` green, `npm run build` and
   `VITE_DEMO=1 npm run build` both green, `npm run lint` clean.
3. **TOTP 2FA — Task 3: Playwright e2e + user documentation (EN + FR)**
   `tests/e2e/totp-2fa.spec.ts` covering enrol → logout → TOTP login →
   recovery-code login → disable, with `page.clock.install` for
   determinism; `docs/users/security.md` + `website/i18n/fr/…/security.md`
   sections on enrolling, saving recovery codes, and what happens on
   backup restore. Success criteria: e2e green in CI; Docusaurus
   `npm run build` green for both locales; cross-link added from the
   Sécurité settings page's help text.

Optional follow-ups (do NOT append until validated by usage — surface only
if a user hits them):

- **Per-user failed-verify cool-down** (stronger brute-force resistance
  than the IP rate limit).
- **TOTP on the desktop idle-lock screen** (`AUTH_MODE=none` variant of
  this feature — needs its own design pass).
- **Multi-device TOTP with per-device labels** — probably YAGNI, note
  only.
