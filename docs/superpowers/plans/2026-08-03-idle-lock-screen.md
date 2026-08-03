# Idle Lock Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the un-authenticated blur privacy mode with a password-verified idle lock screen, including an opt-in lock password on the desktop app (`AUTH_MODE=none`).

**Architecture:** Backend grows four routes in the existing `auth.ts` (verify, lock-status, lock-password, lock-password/reset) — no schema change; the desktop lock password reuses `users.passwordHash` on the hard-coded local row. Frontend: `PrivacyContext` becomes `LockContext` (idle timer kept, reveal now server-verified, lock flag persisted in localStorage), a `LockScreen` overlay renders in `App`, the eye button becomes "lock now", and a desktop-only settings card manages the lock password.

**Tech Stack:** Fastify + zod + @node-rs/argon2 + drizzle (backend), React + react-query + i18next + vitest/@testing-library (frontend).

**Spec:** `docs/superpowers/specs/2026-08-03-idle-lock-screen-design.md` — read it first.

## Global Constraints

- Commit directly to `main` with identity `-c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com`; never push unless asked.
- Backend DB tests: run `cd backend && DB_DRIVER=pglite RUN_DB_TESTS=1 npx vitest run tests/<file>`; plain `npx vitest run` must stay green (DB files skip).
- Frontend: `cd frontend && npx vitest run` green; ESLint `max-lines: 300` is a CI error — keep new files under 300 lines and check via `cd frontend && rtk proxy npx eslint src/<file>`.
- All user-facing copy in fr AND en locale files; French is the primary voice.
- Never use `<input type="number">` (project rule); passwords use `type="password"`.
- Rate limits on all four new routes: `{ max: 10, timeWindow: '1 minute' }`.
- The `privacy-on` CSS class name and `IDLE_MS = 5 * 60 * 1000` stay unchanged.

---

### Task 1: Backend — POST /api/auth/verify

**Files:**
- Modify: `backend/src/http/routes/auth.ts` (append inside `authRoutes`)
- Test: `backend/tests/auth-lock-route.test.ts` (create)

**Interfaces:**
- Consumes: existing `app.requireAuth`, `ARGON2_OPTS`, `users` table.
- Produces: `POST /api/auth/verify` body `{ password: string }` → `200 { ok: true }` | `401 { error: 'invalid credentials' }` | `400 { error: 'invalid input' }`. Tasks 4–5 call it via the api client.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/auth-lock-route.test.ts` following the `budgets-route.test.ts` pattern:

```ts
// requires Postgres/pglite — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

const RUN = !!process.env.RUN_DB_TESTS && process.env.AUTH_MODE !== 'none';

let app: FastifyInstance;
let cookie: string;

describe.skipIf(!RUN)('lock routes — session mode', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();
    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'lock-user', password: 'lock-pass-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'lock-user', password: 'lock-pass-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;
  });

  it('verify: correct password → 200 ok', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/auth/verify',
      headers: { cookie }, payload: { password: 'lock-pass-1234' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it('verify: wrong password → 401', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/auth/verify',
      headers: { cookie }, payload: { password: 'nope-nope-nope' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('invalid credentials');
  });

  it('verify: no session → 401', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/auth/verify',
      payload: { password: 'lock-pass-1234' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('verify: malformed body → 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/auth/verify',
      headers: { cookie }, payload: { password: '' },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DB_DRIVER=pglite RUN_DB_TESTS=1 npx vitest run tests/auth-lock-route.test.ts`
Expected: FAIL — verify requests return 404 (route not registered).

- [ ] **Step 3: Implement the route**

Append inside `authRoutes` in `backend/src/http/routes/auth.ts`:

```ts
  const VerifyBody = z.object({ password: z.string().min(1) });

  // Re-authentication for the lock screen: proves the person at the keyboard
  // knows the password without touching the session. Same rate limit as
  // login — it is the same brute-force surface.
  app.post('/api/auth/verify', {
    preHandler: app.requireAuth,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const parsed = VerifyBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, req.session.userId!))
      .limit(1);
    if (!user) return reply.code(401).send({ error: 'invalid credentials' });

    // .catch(false): the desktop placeholder hash is not a valid argon2
    // string and makes verify() throw rather than return false.
    const ok = await verify(user.passwordHash, parsed.data.password).catch(() => false);
    if (!ok) return reply.code(401).send({ error: 'invalid credentials' });
    return { ok: true };
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && DB_DRIVER=pglite RUN_DB_TESTS=1 npx vitest run tests/auth-lock-route.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the whole backend suite ungated, then commit**

Run: `cd backend && npx vitest run` — DB files must skip cleanly, everything else green.

```bash
git add backend/src/http/routes/auth.ts backend/tests/auth-lock-route.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "feat(auth): POST /api/auth/verify — password re-check for the lock screen"
```

---

### Task 2: Backend — GET /api/auth/lock-status

**Files:**
- Modify: `backend/src/domain/auth/localUser.ts` (export the placeholder)
- Modify: `backend/src/http/routes/auth.ts`
- Test: `backend/tests/auth-lock-route.test.ts` (extend)

**Interfaces:**
- Consumes: `env.AUTH_MODE` from `backend/src/env.js`, `LOCAL_USER_ID` and (newly exported) `LOCAL_PLACEHOLDER_HASH` from `localUser.js`.
- Produces: `GET /api/auth/lock-status` → `200 { mode: 'session' | 'none', lockConfigured: boolean }`. Task 4's provider and Task 6's settings card consume this shape, react-query key `['lock-status']`.

- [ ] **Step 1: Export the placeholder hash**

In `backend/src/domain/auth/localUser.ts` change the const to an export (keep the comment):

```ts
export const LOCAL_PLACEHOLDER_HASH = '$argon2id$local-user-no-login';
```

- [ ] **Step 2: Write the failing test**

Add to the `describe` block in `backend/tests/auth-lock-route.test.ts`:

```ts
  it('lock-status: session mode → lock always configured', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/lock-status', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ mode: 'session', lockConfigured: true });
  });

  it('lock-status: no session → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/lock-status' });
    expect(res.statusCode).toBe(401);
  });
```

Run: `cd backend && DB_DRIVER=pglite RUN_DB_TESTS=1 npx vitest run tests/auth-lock-route.test.ts`
Expected: FAIL with 404 on lock-status.

- [ ] **Step 3: Implement the route**

In `backend/src/http/routes/auth.ts`, add imports:

```ts
import { env } from '../../env.js';
import { LOCAL_USER_ID, LOCAL_PLACEHOLDER_HASH } from '../../domain/auth/localUser.js';
```

Append inside `authRoutes`:

```ts
  // Tells the frontend whether a lock password exists at all. In session
  // mode the account password is the lock; in none mode (desktop) the lock
  // is opt-in and lives in the local row's passwordHash.
  app.get('/api/auth/lock-status', { preHandler: app.requireAuth }, async () => {
    if (env.AUTH_MODE !== 'none') {
      return { mode: 'session' as const, lockConfigured: true };
    }
    const [user] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, LOCAL_USER_ID))
      .limit(1);
    return {
      mode: 'none' as const,
      lockConfigured: !!user && user.passwordHash !== LOCAL_PLACEHOLDER_HASH,
    };
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && DB_DRIVER=pglite RUN_DB_TESTS=1 npx vitest run tests/auth-lock-route.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/http/routes/auth.ts backend/src/domain/auth/localUser.ts backend/tests/auth-lock-route.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "feat(auth): GET /api/auth/lock-status — is a lock password configured"
```

---

### Task 3: Backend — desktop lock-password management (PUT + reset)

**Files:**
- Modify: `backend/src/http/routes/auth.ts`
- Test: `backend/tests/auth-none-mode.test.ts` (extend), `backend/tests/auth-lock-route.test.ts` (extend)

**Interfaces:**
- Consumes: Task 2's exports (`env`, `LOCAL_USER_ID`, `LOCAL_PLACEHOLDER_HASH`).
- Produces:
  - `PUT /api/auth/lock-password` (none mode only, 404 otherwise) body `{ currentPassword?, newPassword? }` → `200 { lockConfigured: boolean }` | `400` | `401 { error: 'current password incorrect' }`.
  - `POST /api/auth/lock-password/reset` (none mode only, 404 otherwise) → `200 { ok: true }`.
  - Task 6's settings card calls the PUT; docs (Task 7) document the reset curl.

- [ ] **Step 1: Write the failing session-mode tests (404s)**

Add to `backend/tests/auth-lock-route.test.ts`:

```ts
  it('lock-password routes do not exist in session mode', async () => {
    const put = await app.inject({
      method: 'PUT', url: '/api/auth/lock-password',
      headers: { cookie }, payload: { newPassword: 'whatever-123' },
    });
    expect(put.statusCode).toBe(404);
    const reset = await app.inject({
      method: 'POST', url: '/api/auth/lock-password/reset', headers: { cookie },
    });
    expect(reset.statusCode).toBe(404);
  });
```

- [ ] **Step 2: Write the failing none-mode tests**

Append a new `describe` to `backend/tests/auth-none-mode.test.ts` (same `RUN` gate, same `app`; add `LOCAL_PLACEHOLDER_HASH` to the existing `localUser.js` dynamic import if needed). Tests run in order:

```ts
describe.skipIf(!RUN)('AUTH_MODE=none — desktop lock password', () => {
  it('lock-status starts unconfigured (placeholder hash)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/lock-status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ mode: 'none', lockConfigured: false });
  });

  it('verify against the placeholder is a plain 401, not a crash', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/auth/verify', payload: { password: 'anything' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('set: newPassword only while unconfigured', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/api/auth/lock-password',
      payload: { newPassword: 'desk-lock-123' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().lockConfigured).toBe(true);
    const status = await app.inject({ method: 'GET', url: '/api/auth/lock-status' });
    expect(status.json().lockConfigured).toBe(true);
  });

  it('verify now accepts the lock password', async () => {
    const ok = await app.inject({
      method: 'POST', url: '/api/auth/verify', payload: { password: 'desk-lock-123' },
    });
    expect(ok.statusCode).toBe(200);
    const bad = await app.inject({
      method: 'POST', url: '/api/auth/verify', payload: { password: 'wrong' },
    });
    expect(bad.statusCode).toBe(401);
  });

  it('change: requires the current password', async () => {
    const refused = await app.inject({
      method: 'PUT', url: '/api/auth/lock-password',
      payload: { currentPassword: 'wrong', newPassword: 'new-lock-456' },
    });
    expect(refused.statusCode).toBe(401);
    const changed = await app.inject({
      method: 'PUT', url: '/api/auth/lock-password',
      payload: { currentPassword: 'desk-lock-123', newPassword: 'new-lock-456' },
    });
    expect(changed.statusCode).toBe(200);
  });

  it('remove: currentPassword only → back to unconfigured', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/api/auth/lock-password',
      payload: { currentPassword: 'new-lock-456' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().lockConfigured).toBe(false);
  });

  it('reset: recovery endpoint restores the placeholder', async () => {
    await app.inject({
      method: 'PUT', url: '/api/auth/lock-password',
      payload: { newPassword: 'forgotten-789' },
    });
    const reset = await app.inject({ method: 'POST', url: '/api/auth/lock-password/reset' });
    expect(reset.statusCode).toBe(200);
    const status = await app.inject({ method: 'GET', url: '/api/auth/lock-status' });
    expect(status.json().lockConfigured).toBe(false);
  });
});
```

Run: `cd backend && AUTH_MODE=none DB_DRIVER=pglite RUN_DB_TESTS=1 npx vitest run tests/auth-none-mode.test.ts`
Expected: FAIL — 404s on the new routes.

- [ ] **Step 3: Implement both routes**

Append inside `authRoutes` in `backend/src/http/routes/auth.ts`:

```ts
  // Desktop-only lock password management. In session mode the account
  // password fills this role (PATCH /api/auth/me) and these routes 404.
  const LockPasswordBody = z.object({
    currentPassword: z.string().min(1).optional(),
    newPassword: z.string().min(8).max(256).optional(),
  });

  app.put('/api/auth/lock-password', {
    preHandler: app.requireAuth,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    if (env.AUTH_MODE !== 'none') return reply.code(404).send({ error: 'not found' });
    const parsed = LockPasswordBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const { currentPassword, newPassword } = parsed.data;

    const [user] = await db.select().from(users).where(eq(users.id, LOCAL_USER_ID)).limit(1);
    if (!user) return reply.code(500).send({ error: 'local user missing' });
    const configured = user.passwordHash !== LOCAL_PLACEHOLDER_HASH;

    if (configured) {
      if (!currentPassword) return reply.code(400).send({ error: 'current password required' });
      const ok = await verify(user.passwordHash, currentPassword).catch(() => false);
      if (!ok) return reply.code(401).send({ error: 'current password incorrect' });
    }
    if (!newPassword && !configured) {
      return reply.code(400).send({ error: 'nothing to change' });
    }

    const passwordHash = newPassword
      ? await hash(newPassword, ARGON2_OPTS)
      : LOCAL_PLACEHOLDER_HASH; // remove → back to "no lock"
    await db.update(users).set({ passwordHash }).where(eq(users.id, LOCAL_USER_ID));
    return { lockConfigured: !!newPassword };
  });

  // Documented "forgot my desktop lock password" recovery (curl with
  // physical access). A curl-capable intruder could read the local DB
  // anyway, so this adds no surface beyond the desktop trust model.
  app.post('/api/auth/lock-password/reset', {
    preHandler: app.requireAuth,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    if (env.AUTH_MODE !== 'none') return reply.code(404).send({ error: 'not found' });
    await db.update(users)
      .set({ passwordHash: LOCAL_PLACEHOLDER_HASH })
      .where(eq(users.id, LOCAL_USER_ID));
    return { ok: true };
  });
```

- [ ] **Step 4: Run both suites**

Run: `cd backend && DB_DRIVER=pglite RUN_DB_TESTS=1 npx vitest run tests/auth-lock-route.test.ts`
Run: `cd backend && AUTH_MODE=none DB_DRIVER=pglite RUN_DB_TESTS=1 npx vitest run tests/auth-none-mode.test.ts`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/http/routes/auth.ts backend/tests/auth-none-mode.test.ts backend/tests/auth-lock-route.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "feat(auth): desktop lock-password set/change/remove + curl recovery reset"
```

---

### Task 4: Frontend — LockContext replaces PrivacyContext

**Files:**
- Create: `frontend/src/contexts/LockContext.tsx`
- Create: `frontend/src/contexts/__tests__/LockContext.test.tsx`
- Delete: `frontend/src/contexts/PrivacyContext.tsx`, `frontend/src/contexts/__tests__/PrivacyContext.test.tsx`
- Modify: `frontend/src/api/client.ts` (exempt `/api/auth/verify` from the global 401 hook)
- Modify: `frontend/src/App.tsx`, `frontend/src/components/Layout/UserCard.tsx` (imports only, to keep tsc green — behavior changes land in Task 5)

**Interfaces:**
- Consumes: `api()` and `ApiError` from `../api/client`, `GET /api/auth/lock-status` (Task 2), `POST /api/auth/verify` (Task 1), react-query (`useQuery` key `['lock-status']`).
- Produces: `LockProvider`, `useLock(): { locked: boolean; lockAvailable: boolean; lockNow(): void; unlock(password: string): Promise<void> }`, `LOCK_FLAG_KEY = 'athena.locked'`, exported type `LockStatus = { mode: 'session' | 'none'; lockConfigured: boolean }`. Tasks 5 and 6 import these exact names.

- [ ] **Step 1: Exempt verify from the global 401 hook**

In `frontend/src/api/client.ts`, the `handle401` path check currently reads `if (path === '/api/auth/me') return;`. Change to:

```ts
  // /api/auth/me 401s are the normal "not logged in" probe, and a wrong
  // lock-screen password must not be treated as a dead session.
  if (path === '/api/auth/me' || path === '/api/auth/verify') return;
```

Without this, a mistyped lock password would clear the query cache and bounce the user to /login — exactly what the lock screen exists to avoid.

- [ ] **Step 2: Write the failing tests**

Create `frontend/src/contexts/__tests__/LockContext.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LockProvider, useLock, LOCK_FLAG_KEY } from '../LockContext';
import { api } from '../../api/client';

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  api: vi.fn(),
}));
const mockedApi = vi.mocked(api);

function Probe() {
  const lock = useLock();
  return (
    <div>
      <span data-testid="locked">{String(lock.locked)}</span>
      <span data-testid="available">{String(lock.lockAvailable)}</span>
      <button onClick={lock.lockNow}>lock</button>
      <button onClick={() => void lock.unlock('pw').catch(() => {})}>unlock</button>
    </div>
  );
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LockProvider><Probe /></LockProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  document.documentElement.classList.remove('privacy-on');
  mockedApi.mockReset();
  // Default: LAN session mode, lock always available.
  mockedApi.mockImplementation(async (path: string) => {
    if (path === '/api/auth/lock-status') return { mode: 'session', lockConfigured: true };
    if (path === '/api/auth/verify') return { ok: true };
    throw new Error(`unexpected api call: ${path}`);
  });
});

afterEach(() => vi.useRealTimers());

describe('LockContext', () => {
  it('locks after 5 minutes idle and mirrors privacy-on onto <html>', async () => {
    mount();
    await act(async () => { await vi.runOnlyPendingTimersAsync(); }); // settle lock-status query
    expect(screen.getByTestId('locked').textContent).toBe('false');
    act(() => { vi.advanceTimersByTime(5 * 60 * 1000); });
    expect(screen.getByTestId('locked').textContent).toBe('true');
    expect(document.documentElement.classList.contains('privacy-on')).toBe(true);
    expect(localStorage.getItem(LOCK_FLAG_KEY)).toBe('1');
  });

  it('lockNow() locks immediately', async () => {
    mount();
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    fireEvent.click(screen.getByText('lock'));
    expect(screen.getByTestId('locked').textContent).toBe('true');
  });

  it('boots locked when the localStorage flag is present', () => {
    localStorage.setItem(LOCK_FLAG_KEY, '1');
    mount();
    expect(screen.getByTestId('locked').textContent).toBe('true');
  });

  it('unlock() verifies server-side, then clears state and flag', async () => {
    localStorage.setItem(LOCK_FLAG_KEY, '1');
    mount();
    fireEvent.click(screen.getByText('unlock'));
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    expect(mockedApi).toHaveBeenCalledWith('/api/auth/verify', {
      method: 'POST', json: { password: 'pw' },
    });
    expect(screen.getByTestId('locked').textContent).toBe('false');
    expect(localStorage.getItem(LOCK_FLAG_KEY)).toBeNull();
  });

  it('never arms the timer when no lock is configured (desktop default)', async () => {
    mockedApi.mockImplementation(async (path: string) => {
      if (path === '/api/auth/lock-status') return { mode: 'none', lockConfigured: false };
      throw new Error(`unexpected api call: ${path}`);
    });
    mount();
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    expect(screen.getByTestId('available').textContent).toBe('false');
    act(() => { vi.advanceTimersByTime(10 * 60 * 1000); });
    expect(screen.getByTestId('locked').textContent).toBe('false');
  });

  it('force-unlocks a stale flag when the lock was reset out-of-band', async () => {
    // Desktop recovery: curl reset cleared the hash, but the old flag remains.
    localStorage.setItem(LOCK_FLAG_KEY, '1');
    mockedApi.mockImplementation(async (path: string) => {
      if (path === '/api/auth/lock-status') return { mode: 'none', lockConfigured: false };
      throw new Error(`unexpected api call: ${path}`);
    });
    mount();
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    await waitFor(() => expect(screen.getByTestId('locked').textContent).toBe('false'));
    expect(localStorage.getItem(LOCK_FLAG_KEY)).toBeNull();
  });

  it('activity resets the idle countdown', async () => {
    mount();
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    act(() => { vi.advanceTimersByTime(4 * 60 * 1000); });
    act(() => { window.dispatchEvent(new MouseEvent('mousemove')); });
    act(() => { vi.advanceTimersByTime(4 * 60 * 1000); });
    expect(screen.getByTestId('locked').textContent).toBe('false');
    act(() => { vi.advanceTimersByTime(60 * 1000); });
    expect(screen.getByTestId('locked').textContent).toBe('true');
  });
});
```

Run: `cd frontend && npx vitest run src/contexts/__tests__/LockContext.test.tsx`
Expected: FAIL — module `../LockContext` not found.

- [ ] **Step 3: Implement LockContext**

Create `frontend/src/contexts/LockContext.tsx`:

```tsx
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

const IDLE_MS = 5 * 60 * 1000; // 5 minutes
export const LOCK_FLAG_KEY = 'athena.locked';

export interface LockStatus {
  mode: 'session' | 'none';
  lockConfigured: boolean;
}

interface LockContextValue {
  locked: boolean;
  lockAvailable: boolean;
  lockNow: () => void;
  unlock: (password: string) => Promise<void>;
}

const LockCtx = createContext<LockContextValue | null>(null);

export function useLock() {
  const ctx = useContext(LockCtx);
  if (!ctx) throw new Error('useLock() used outside <LockProvider>');
  return ctx;
}

// Tracks user inactivity and, after IDLE_MS, locks the app behind a
// password prompt. The flag is mirrored to localStorage so an F5 or an app
// relaunch boots straight into the locked state — without that, a reload
// with the still-valid session cookie would bypass the lock entirely.
export function LockProvider({ children }: { children: ReactNode }) {
  const [locked, setLocked] = useState(() => localStorage.getItem(LOCK_FLAG_KEY) === '1');
  const timerRef = useRef<number | null>(null);

  const status = useQuery({
    queryKey: ['lock-status'],
    queryFn: () => api<LockStatus>('/api/auth/lock-status'),
    staleTime: Infinity,
  });
  const lockAvailable = status.data?.lockConfigured ?? false;

  function engage() {
    localStorage.setItem(LOCK_FLAG_KEY, '1');
    setLocked(true);
  }

  useEffect(() => {
    // Mirror the React state onto <html> so global CSS hides amounts in the
    // layer beneath the overlay too.
    document.documentElement.classList.toggle('privacy-on', locked);
  }, [locked]);

  // Desktop recovery: if the lock password was reset out-of-band (curl),
  // lock-status reports unconfigured — a leftover flag must not brick the UI.
  useEffect(() => {
    if (locked && status.data && !status.data.lockConfigured) {
      localStorage.removeItem(LOCK_FLAG_KEY);
      setLocked(false);
    }
  }, [locked, status.data]);

  useEffect(() => {
    if (locked || !lockAvailable) return;

    const onActivity = () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(engage, IDLE_MS);
    };

    const events: (keyof WindowEventMap)[] = [
      'mousemove', 'keydown', 'scroll', 'touchstart', 'click',
    ];
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    onActivity(); // arm the timer immediately

    return () => {
      events.forEach((e) => window.removeEventListener(e, onActivity));
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [locked, lockAvailable]);

  const value: LockContextValue = {
    locked,
    lockAvailable,
    lockNow: engage,
    unlock: async (password: string) => {
      await api<{ ok: boolean }>('/api/auth/verify', { method: 'POST', json: { password } });
      localStorage.removeItem(LOCK_FLAG_KEY);
      setLocked(false);
    },
  };

  return <LockCtx.Provider value={value}>{children}</LockCtx.Provider>;
}
```

- [ ] **Step 4: Swap the provider in App.tsx and UserCard.tsx (compile-level only)**

- `frontend/src/App.tsx`: replace `import { PrivacyProvider } from './contexts/PrivacyContext';` with `import { LockProvider } from './contexts/LockContext';` and the `<PrivacyProvider>`/`</PrivacyProvider>` pair with `<LockProvider>`/`</LockProvider>`.
- `frontend/src/components/Layout/UserCard.tsx`: replace `usePrivacy` with `useLock` and make the eye button minimal-but-working for now (full UX in Task 5):

```tsx
import { useLock } from '../../contexts/LockContext';
// …
const lock = useLock();
// …the privacy button becomes:
{lock.lockAvailable && (
  <button
    className="btn-ghost w-full justify-start text-xs mb-1"
    onClick={lock.lockNow}
    title={t('user.lock.title')}
  >
    <EyeClosedIcon />
    {t('user.lock.button')}
  </button>
)}
```

Delete `EyeOpenIcon` (now unused). Add the i18n keys in `frontend/src/locales/fr/layout.json` (replace the whole `"privacy"` object under `"user"`):

```json
"lock": {
  "button": "Verrouiller l'écran",
  "title": "Verrouiller l'écran (auto après 5 min d'inactivité)"
}
```

and `frontend/src/locales/en/layout.json`:

```json
"lock": {
  "button": "Lock the screen",
  "title": "Lock the screen (auto after 5 min idle)"
}
```

- [ ] **Step 5: Delete the old context and its test; fix remaining references**

```bash
rm frontend/src/contexts/PrivacyContext.tsx frontend/src/contexts/__tests__/PrivacyContext.test.tsx
```

Then `cd frontend && rtk proxy npx tsc --noEmit` and chase every remaining `usePrivacy`/`PrivacyProvider` reference (Layout tests will be updated in Task 5 — if `frontend/src/components/__tests__/Layout.test.tsx` or `frontend/src/__tests__/App.test.tsx` reference privacy, update their mocks/providers to `LockProvider` with a `QueryClientProvider` and a mocked `api` returning `{ mode: 'session', lockConfigured: true }`).

- [ ] **Step 6: Run tests**

Run: `cd frontend && npx vitest run src/contexts/__tests__/LockContext.test.tsx`
Expected: PASS (7 tests).
Run: `cd frontend && npx vitest run`
Expected: full suite green (fix fallout from the rename as part of this task).

- [ ] **Step 7: Commit**

```bash
git add -A frontend/src
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "feat(lock): LockContext — idle lock with server-verified unlock replaces blur context"
```

---

### Task 5: Frontend — LockScreen overlay

**Files:**
- Create: `frontend/src/components/LockScreen.tsx`
- Create: `frontend/src/components/__tests__/LockScreen.test.tsx`
- Modify: `frontend/src/App.tsx` (render the overlay), `frontend/src/locales/{fr,en}/layout.json`

**Interfaces:**
- Consumes: `useLock()` (Task 4), `['lock-status']` query data (`LockStatus`), `api()` for logout, i18n namespace `layout`.
- Produces: `<LockScreen username={string} />` — renders `null` when unlocked; App mounts it inside `LockProvider`, right before `<Routes>`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/__tests__/LockScreen.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LockProvider, LOCK_FLAG_KEY } from '../../contexts/LockContext';
import { LockScreen } from '../LockScreen';
import { api, ApiError } from '../../api/client';

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  api: vi.fn(),
}));
const mockedApi = vi.mocked(api);

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LockProvider>
        <LockScreen username="julien" />
        <div data-testid="app">app content</div>
      </LockProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.setItem(LOCK_FLAG_KEY, '1'); // boot locked
  mockedApi.mockReset();
  mockedApi.mockImplementation(async (path: string) => {
    if (path === '/api/auth/lock-status') return { mode: 'session', lockConfigured: true };
    if (path === '/api/auth/verify') return { ok: true };
    if (path === '/api/auth/logout') return { ok: true };
    throw new Error(`unexpected api call: ${path}`);
  });
});

describe('LockScreen', () => {
  it('shows the overlay with the username while locked', async () => {
    mount();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('julien')).toBeInTheDocument();
  });

  it('unlocks on correct password', async () => {
    mount();
    fireEvent.change(await screen.findByLabelText(/mot de passe/i), { target: { value: 'good' } });
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows the wrong-password error on 401 and stays locked', async () => {
    mockedApi.mockImplementation(async (path: string) => {
      if (path === '/api/auth/lock-status') return { mode: 'session', lockConfigured: true };
      if (path === '/api/auth/verify') throw new ApiError('invalid credentials', 401);
      throw new Error(`unexpected api call: ${path}`);
    });
    mount();
    fireEvent.change(await screen.findByLabelText(/mot de passe/i), { target: { value: 'bad' } });
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    expect(await screen.findByText(/mot de passe incorrect/i)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('session mode shows the logout escape hatch', async () => {
    mount();
    expect(await screen.findByText(/se déconnecter/i)).toBeInTheDocument();
  });
});
```

Check `ApiError`'s constructor signature in `frontend/src/api/` before writing the throw — match its real arguments (it is the class `client.ts` re-exports; adjust `new ApiError(...)` in the test to the actual signature).

Run: `cd frontend && npx vitest run src/components/__tests__/LockScreen.test.tsx`
Expected: FAIL — `../LockScreen` not found.

- [ ] **Step 2: Implement LockScreen**

Create `frontend/src/components/LockScreen.tsx` (match app styling conventions — dark ink palette, `btn-primary`, `.card` if available; check `frontend/src/pages/Login.tsx` for the closest look to copy):

```tsx
import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api/client';
import { useLock, LOCK_FLAG_KEY, type LockStatus } from '../contexts/LockContext';

// Full-viewport lock overlay. Rendered above the whole app while locked;
// unlocking re-verifies the password server-side, so state beneath the
// overlay (page, filters, drafts) survives untouched.
export function LockScreen({ username }: { username: string }) {
  const { locked, unlock } = useLock();
  const { t } = useTranslation('layout');
  const qc = useQueryClient();
  const mode = qc.getQueryData<LockStatus>(['lock-status'])?.mode ?? 'session';

  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const logout = useMutation({
    mutationFn: () => api<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      localStorage.removeItem(LOCK_FLAG_KEY);
      qc.clear();
      qc.setQueryData(['me'], { user: null });
    },
  });

  if (!locked) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await unlock(password);
      setPassword('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError(t('lock.rateLimited'));
      } else if (err instanceof ApiError && err.status === 401 && err.message === 'authentication required') {
        // Session died while idle — fall back to the login screen.
        qc.clear();
        qc.setQueryData(['me'], { user: null });
        return;
      } else {
        setError(t('lock.wrongPassword'));
      }
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('lock.screenTitle')}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink-950/95 backdrop-blur"
    >
      <form onSubmit={submit} className="w-full max-w-xs p-6 text-center">
        <h1 className="text-lg font-semibold text-ink-50 mb-1">{t('lock.screenTitle')}</h1>
        <p className="text-sm text-ink-300 mb-4">{username}</p>
        <label htmlFor="lock-password" className="label block text-left mb-1">
          {t('lock.passwordLabel')}
        </label>
        <input
          id="lock-password"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input w-full mb-3"
        />
        {error && <p className="text-sm text-clay-400 mb-3">{error}</p>}
        <button className="btn-primary w-full" disabled={busy || !password}>
          {t('lock.unlock')}
        </button>
        {mode === 'session' ? (
          <button
            type="button"
            className="btn-ghost w-full justify-center text-xs mt-3"
            onClick={() => logout.mutate()}
          >
            {t('user.logout')}
          </button>
        ) : (
          <p className="text-xs text-ink-400 mt-3">{t('lock.forgotHint')}</p>
        )}
      </form>
    </div>
  );
}
```

Adjust class names to real utilities from the codebase (`input`, `label`, `btn-primary`, `btn-ghost`, ink/clay palette — verify in `frontend/src/index.css`; the structure is the contract, the classes must match the app's actual design system).

- [ ] **Step 3: Add the i18n keys**

`frontend/src/locales/fr/layout.json`, new top-level `"lock"` object (sibling of `"user"`):

```json
"lock": {
  "screenTitle": "Écran verrouillé",
  "passwordLabel": "Mot de passe",
  "unlock": "Déverrouiller",
  "wrongPassword": "Mot de passe incorrect.",
  "rateLimited": "Trop de tentatives — réessayez dans une minute.",
  "forgotHint": "Mot de passe oublié ? Consultez la documentation « Sécurité et confidentialité » pour la procédure de réinitialisation."
}
```

`frontend/src/locales/en/layout.json`:

```json
"lock": {
  "screenTitle": "Screen locked",
  "passwordLabel": "Password",
  "unlock": "Unlock",
  "wrongPassword": "Incorrect password.",
  "rateLimited": "Too many attempts — try again in a minute.",
  "forgotHint": "Forgot your password? See the “Security & privacy” docs for the reset procedure."
}
```

(The `user.lock.*` keys from Task 4 stay where they are; these `lock.*` keys are top-level.)

- [ ] **Step 4: Mount in App.tsx**

Inside the `LockProvider` block in `frontend/src/App.tsx`, right after `<TourBubble />`:

```tsx
<LockScreen username={user.username} />
```

with `import { LockScreen } from './components/LockScreen';`.

- [ ] **Step 5: Run tests, lint, build**

Run: `cd frontend && npx vitest run src/components/__tests__/LockScreen.test.tsx` → PASS.
Run: `cd frontend && npx vitest run` → green.
Run: `cd frontend && rtk proxy npx eslint src/components/LockScreen.tsx src/contexts/LockContext.tsx` → clean.
Run: `cd frontend && rtk proxy npx tsc --noEmit && npx vite build` → green.

- [ ] **Step 6: Commit**

```bash
git add frontend/src
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "feat(lock): LockScreen overlay — password-verified unlock, state survives"
```

---

### Task 6: Frontend — desktop lock-password settings card

**Files:**
- Create: `frontend/src/pages/SettingsLock.tsx`
- Create: `frontend/src/pages/__tests__/SettingsLock.test.tsx`
- Modify: `frontend/src/pages/Settings.tsx` (render the card), `frontend/src/locales/{fr,en}/settings.json`

**Interfaces:**
- Consumes: `['lock-status']` query (`LockStatus` from Task 4), `PUT /api/auth/lock-password` (Task 3).
- Produces: `<SettingsLock />`, self-contained card that renders `null` unless `mode === 'none'`. Invalidates `['lock-status']` on every successful mutation so the eye button / idle timer react instantly.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/pages/__tests__/SettingsLock.test.tsx` (mock `api` as in Task 4; mount with `QueryClientProvider` only — the card reads lock-status itself via `useQuery`):

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SettingsLock } from '../SettingsLock';
import { api } from '../../api/client';

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  api: vi.fn(),
}));
const mockedApi = vi.mocked(api);

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><SettingsLock /></QueryClientProvider>,
  );
}

beforeEach(() => mockedApi.mockReset());

describe('SettingsLock', () => {
  it('renders nothing in session mode (LAN — account password is the lock)', async () => {
    mockedApi.mockResolvedValue({ mode: 'session', lockConfigured: true });
    const { container } = mount();
    await waitFor(() => expect(mockedApi).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('offers the set form when unconfigured, and sets the password', async () => {
    mockedApi.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/api/auth/lock-status') return { mode: 'none', lockConfigured: false };
      if (path === '/api/auth/lock-password' && init?.method === 'PUT') return { lockConfigured: true };
      throw new Error(`unexpected: ${path}`);
    });
    mount();
    fireEvent.change(await screen.findByLabelText(/nouveau mot de passe/i), { target: { value: 'desk-lock-123' } });
    fireEvent.change(screen.getByLabelText(/confirmer/i), { target: { value: 'desk-lock-123' } });
    fireEvent.click(screen.getByRole('button', { name: /définir/i }));
    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/api/auth/lock-password', {
        method: 'PUT', json: { newPassword: 'desk-lock-123' },
      }),
    );
  });

  it('offers change and remove when configured', async () => {
    mockedApi.mockResolvedValue({ mode: 'none', lockConfigured: true });
    mount();
    expect(await screen.findByLabelText(/mot de passe actuel/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /supprimer/i })).toBeInTheDocument();
  });

  it('rejects a mismatched confirmation client-side', async () => {
    mockedApi.mockResolvedValue({ mode: 'none', lockConfigured: false });
    mount();
    fireEvent.change(await screen.findByLabelText(/nouveau mot de passe/i), { target: { value: 'desk-lock-123' } });
    fireEvent.change(screen.getByLabelText(/confirmer/i), { target: { value: 'different' } });
    fireEvent.click(screen.getByRole('button', { name: /définir/i }));
    expect(await screen.findByText(/ne correspondent pas/i)).toBeInTheDocument();
    expect(mockedApi).not.toHaveBeenCalledWith('/api/auth/lock-password', expect.anything());
  });
});
```

Run: `cd frontend && npx vitest run src/pages/__tests__/SettingsLock.test.tsx` → FAIL (module not found).

- [ ] **Step 2: Implement the card**

Create `frontend/src/pages/SettingsLock.tsx`, modeled on `Profile.tsx`'s form/mutation/error pattern and Settings' card markup (open `frontend/src/pages/Settings.tsx` and copy an existing card wrapper: heading + description + form). Behavior contract:

```tsx
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api/client';
import type { LockStatus } from '../contexts/LockContext';

// Desktop-only (AUTH_MODE=none) lock password management. On the LAN build
// the account password is the lock and this card renders nothing.
export function SettingsLock() {
  const { t } = useTranslation('settings');
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ['lock-status'],
    queryFn: () => api<LockStatus>('/api/auth/lock-status'),
    staleTime: Infinity,
  });

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: (json: { currentPassword?: string; newPassword?: string }) =>
      api<{ lockConfigured: boolean }>('/api/auth/lock-password', { method: 'PUT', json }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['lock-status'] });
      setOk(t(vars.newPassword ? 'lock.saved' : 'lock.removed'));
      setCurrent(''); setNext(''); setConfirm('');
    },
    onError: (err: ApiError) => setError(err.message),
  });

  if (!status.data || status.data.mode !== 'none') return null;
  const configured = status.data.lockConfigured;

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null); setOk(null);
    if (next.length < 8) { setError(t('lock.errors.tooShort')); return; }
    if (next !== confirm) { setError(t('lock.errors.mismatch')); return; }
    mut.mutate(configured ? { currentPassword: current, newPassword: next } : { newPassword: next });
  }

  function remove() {
    setError(null); setOk(null);
    mut.mutate({ currentPassword: current });
  }

  // …card markup: title t('lock.title'), body copy t('lock.description'),
  // inputs (all type="password", labeled): current (only when configured),
  // new, confirm; submit button t(configured ? 'lock.change' : 'lock.set');
  // when configured, a secondary "remove" button t('lock.remove') calling
  // remove(), disabled while !current; error/ok lines like Profile.tsx.
}
```

Finish the JSX per the comment — every element named there must exist, labels wired with `htmlFor`/`id` so the tests' `getByLabelText` works.

- [ ] **Step 3: i18n keys**

`frontend/src/locales/fr/settings.json`, top-level `"lock"`:

```json
"lock": {
  "title": "Mot de passe de verrouillage",
  "description": "Protège l'écran après 5 minutes d'inactivité. Sans mot de passe, le verrouillage est désactivé.",
  "currentLabel": "Mot de passe actuel",
  "newLabel": "Nouveau mot de passe",
  "confirmLabel": "Confirmer le nouveau mot de passe",
  "set": "Définir le verrouillage",
  "change": "Modifier",
  "remove": "Supprimer le verrouillage",
  "saved": "Mot de passe de verrouillage enregistré.",
  "removed": "Verrouillage supprimé.",
  "errors": {
    "tooShort": "8 caractères minimum.",
    "mismatch": "Les mots de passe ne correspondent pas."
  }
}
```

`frontend/src/locales/en/settings.json`:

```json
"lock": {
  "title": "Lock password",
  "description": "Protects the screen after 5 minutes of inactivity. Without a password, locking is disabled.",
  "currentLabel": "Current password",
  "newLabel": "New password",
  "confirmLabel": "Confirm new password",
  "set": "Set up locking",
  "change": "Change",
  "remove": "Remove locking",
  "saved": "Lock password saved.",
  "removed": "Locking removed.",
  "errors": {
    "tooShort": "At least 8 characters.",
    "mismatch": "The passwords do not match."
  }
}
```

- [ ] **Step 4: Render in Settings.tsx**

Import and place `<SettingsLock />` in `frontend/src/pages/Settings.tsx` next to the other cards (after the security/bank-sync cards; exact slot at implementer's judgment — it self-hides on LAN).

- [ ] **Step 5: Run tests, lint, build; commit**

Run: `cd frontend && npx vitest run` → green; `rtk proxy npx eslint src/pages/SettingsLock.tsx` → clean (≤300 lines); `rtk proxy npx tsc --noEmit` → green.

```bash
git add frontend/src
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "feat(lock): desktop lock-password settings card (set/change/remove)"
```

---

### Task 7: Demo stub, docs, PLAN.md, full verification

**Files:**
- Modify: `frontend/src/api/demo/handlers/reads/simple.ts`
- Modify: `docs/users/security-and-privacy.md` and `website/i18n/fr/docusaurus-plugin-content-docs/current/users/security-and-privacy.md`
- Modify: `PLAN.md`

**Interfaces:**
- Consumes: everything shipped in Tasks 1–6.
- Produces: demo parity, user docs, planning hygiene.

- [ ] **Step 1: Demo stub**

In `frontend/src/api/demo/handlers/reads/simple.ts`, next to the `/api/auth/me` handler:

```ts
  registerHandler('GET', '/api/auth/lock-status', () => ({ mode: 'session', lockConfigured: false }));
```

`mode: 'session'` keeps the SettingsLock card hidden in the demo, and `lockConfigured: false` disarms the timer and hides the eye button — both without any component special-casing.

Run the demo-handler test suite: `cd frontend && npx vitest run src/api/demo` → green (extend `reads.test.ts` with a one-line assertion for the new handler if the suite pattern expects every handler covered).

- [ ] **Step 2: Docs**

In `docs/users/security-and-privacy.md`, replace the privacy-mode paragraph with a "Screen lock" section covering: idle lock after 5 min, password required to reveal (account password on LAN), desktop opt-in lock password in Réglages, honest framing (client-enforced, protects against the person at the keyboard, not someone with your disk), and desktop recovery:

```bash
curl -X POST http://localhost:<port>/api/auth/lock-password/reset
```

with a note on finding the sidecar port. Mirror section-for-section in the FR file. Build check: `cd website && npm run build` if the site builds locally (skip if heavy — CI covers it, note it in the commit message if skipped).

- [ ] **Step 3: PLAN.md**

In `PLAN.md`: delete the `- [ ] PIN lock for privacy mode — spec first` task from `## Backlog` entirely, and add under `## Done`:

```markdown
- [x] Idle lock screen replaces the blur privacy mode (supersedes the PIN-lock spec task)
      Shipped per docs/superpowers/specs/2026-08-03-idle-lock-screen-design.md: /api/auth/verify + lock-status + desktop lock-password routes, LockContext/LockScreen frontend, desktop opt-in lock password in Réglages, demo stub, docs EN+FR.
```

(Respect the PLAN.md format contract: body lines indented, no blank lines inside the body.)

- [ ] **Step 4: Full verification before finishing**

- `cd backend && npx vitest run` (ungated — DB files skip) → green
- `cd backend && DB_DRIVER=pglite RUN_DB_TESTS=1 npx vitest run` → green
- `cd backend && AUTH_MODE=none DB_DRIVER=pglite RUN_DB_TESTS=1 npx vitest run tests/auth-none-mode.test.ts` → green
- `cd frontend && npx vitest run` → green
- `cd frontend && rtk proxy npx tsc --noEmit && npx vite build` → green

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/demo docs/users PLAN.md website/i18n
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "feat(lock): demo stub, security docs EN+FR, PLAN.md — idle lock screen complete"
```

Do NOT push — the user pushes when they decide to.
