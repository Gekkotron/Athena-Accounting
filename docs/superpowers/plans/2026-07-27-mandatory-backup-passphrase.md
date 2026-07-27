# Mandatory Backup Passphrase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove plaintext backup export — every export requires a passphrase and produces an `enc1` envelope; imports keep accepting legacy plaintext dumps.

**Architecture:** `GET /api/backup/export` becomes a `410 Gone` tombstone; the existing `POST` (passphrase, enc1 output) is the only export. `BackupPanel` always POSTs and requires ≥ 8 chars before enabling the button. Demo mode registers a POST handler.

**Tech Stack:** Fastify, zod, React, react-i18next, vitest.

## Global Constraints

- UI copy is French-first: every new i18n key gets `frontend/src/locales/fr/*.json` AND `en/*.json` values.
- ESLint `max-lines` is 300 (code lines) per file — check with `npx eslint <file> --quiet` after editing.
- Never commit IPs, hostnames, or secrets (repo is going public).
- Commit directly to `main` with `git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit …`. Do not push.
- Backend tests: `cd backend && npx vitest run` (DB-gated files skip locally). Frontend: `cd frontend && npx vitest run`.

---

### Task 1: Backend — plaintext export returns 410

**Files:**
- Modify: `backend/src/http/routes/backup/export.ts:183-188` (the GET route)
- Test: `backend/tests/backup-route.test.ts` (the `GET /api/backup/export` describe block, ~line 85)

**Interfaces:**
- Produces: `GET /api/backup/export` → `410 { error: 'plaintext export removed — POST with a passphrase' }`. POST route unchanged.

- [ ] **Step 1: Update the DB-gated route test**

In `backend/tests/backup-route.test.ts`, find the `describe('GET /api/backup/export', …)` block and replace its assertions on a successful dump with:

```ts
it('is gone — plaintext export was removed', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/api/backup/export',
    cookies: authCookie,
  });
  expect(res.statusCode).toBe(410);
  expect(res.json().error).toMatch(/plaintext export removed/);
});
```

Keep the block's auth-required test if present (unauthenticated is still 401). Any other test in the file that calls `GET /api/backup/export` to obtain a dump (e.g. export→import roundtrips) must switch to the POST variant:

```ts
const res = await app.inject({
  method: 'POST',
  url: '/api/backup/export',
  cookies: authCookie,
  payload: { passphrase: 'test-passphrase' },
});
// res.json() is the enc1 envelope; the roundtrip import then needs
// { ...envelope, passphrase: 'test-passphrase' } as the import payload.
```

- [ ] **Step 2: Run the test file — DB-gated tests skip locally, so just check it parses**

Run: `cd backend && npx vitest run tests/backup-route.test.ts`
Expected: suite loads, everything reported skipped (no `RUN_DB_TESTS`). No syntax/type errors.

- [ ] **Step 3: Replace the GET route with the tombstone**

In `backend/src/http/routes/backup/export.ts`, replace the GET handler body:

```ts
// Plaintext export was removed (2026-07) — backups are always encrypted
// now. 410 (not 404) so old clients/bookmarks get an explanation.
app.get('/api/backup/export', async (_req, reply) => {
  return reply.code(410).send({
    error: 'plaintext export removed — POST with a passphrase',
  });
});
```

`buildDump`, `stampNow`, and the POST route stay exactly as they are. The `userId` import is still used by the POST route.

- [ ] **Step 4: Type-check and lint**

Run: `cd backend && npx tsc --noEmit && npx eslint src/http/routes/backup/export.ts --quiet`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add backend/src/http/routes/backup/export.ts backend/tests/backup-route.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "feat(backup): remove plaintext export — GET /api/backup/export is 410 Gone"
```

---

### Task 2: Frontend — export requires a passphrase

**Files:**
- Modify: `frontend/src/pages/Imports/BackupPanel.tsx` (exportBackup + the export controls JSX)
- Modify: `frontend/src/locales/fr/imports.json`, `frontend/src/locales/en/imports.json` (the `backup.encrypt` object)
- Test: `frontend/src/pages/Imports/__tests__/BackupPanel.test.tsx` (create if absent; check `frontend/src/pages/Imports/` for an existing `__tests__` dir first and follow its conventions)

**Interfaces:**
- Consumes: Task 1's contract — plaintext GET is gone; only `POST /api/backup/export { passphrase }` works.

- [ ] **Step 1: Write the failing component test**

```tsx
import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { BackupPanel } from '../BackupPanel';

describe('BackupPanel export passphrase', () => {
  it('disables export until the passphrase has 8+ characters', () => {
    renderWithProviders(<BackupPanel />);
    const exportBtn = screen.getByRole('button', { name: /exporter/i });
    expect(exportBtn).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/phrase secrète/i), {
      target: { value: 'short' },
    });
    expect(exportBtn).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/phrase secrète/i), {
      target: { value: 'long-enough-passphrase' },
    });
    expect(exportBtn).toBeEnabled();
  });
});
```

Adapt the accessible names to the actual FR strings after Step 3 (check `screen.getByRole` output if the name regex misses). `renderWithProviders` already exists at `frontend/src/test/renderWithProviders.tsx`.

- [ ] **Step 2: Run it — expect failure**

Run: `cd frontend && npx vitest run src/pages/Imports/__tests__/BackupPanel.test.tsx`
Expected: FAIL — button is currently enabled with an empty passphrase.

- [ ] **Step 3: Make the passphrase required in `BackupPanel.tsx`**

1. In `exportBackup`, drop the GET branch entirely:

```ts
const exportBackup = async () => {
  setBackupError(null);
  setBackupResult(null);
  const passphrase = exportPassphrase.trim();
  if (passphrase.length < 8) {
    setBackupError(t('backup.encrypt.tooShort'));
    return;
  }
  setExporting(true);
  try {
    const res = await fetch('/api/backup/export', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ passphrase }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const today = new Date().toISOString().slice(0, 10);
    a.download = `athena-backup-${today}.enc.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    setBackupError(err instanceof Error ? err.message : t('backup.export.failedFallback'));
  } finally {
    setExporting(false);
  }
};
```

2. Disable the export button until valid:

```tsx
<button
  className="btn-primary"
  onClick={exportBackup}
  disabled={exporting || exportPassphrase.trim().length < 8}
>
```

3. Under the controls row, add the no-recovery warning:

```tsx
<p className="text-xs text-clay-300">{t('backup.encrypt.mandatoryWarning')}</p>
```

- [ ] **Step 4: Update i18n copy**

In `frontend/src/locales/fr/imports.json`, inside `backup.encrypt`, set the label/placeholder to the required phrasing and add the warning key (keep existing keys like `tooShort`):

```json
"encrypt": {
  "label": "Phrase secrète (obligatoire, 8 caractères min.)",
  "tooShort": "La phrase secrète doit contenir au moins 8 caractères.",
  "mandatoryWarning": "Les sauvegardes sont toujours chiffrées. Sans cette phrase secrète, la sauvegarde est illisible — conservez-la précieusement."
}
```

Mirror in `frontend/src/locales/en/imports.json`:

```json
"encrypt": {
  "label": "Passphrase (required, min. 8 characters)",
  "tooShort": "The passphrase must be at least 8 characters long.",
  "mandatoryWarning": "Backups are always encrypted. Without this passphrase the backup is unreadable — keep it safe."
}
```

Check both files for the exact existing structure first — merge, don't clobber sibling keys.

- [ ] **Step 5: Run the test — expect pass; run the full frontend suite**

Run: `cd frontend && npx vitest run src/pages/Imports/__tests__/BackupPanel.test.tsx && npx vitest run`
Expected: new test passes; whole suite green (fix any test that relied on plaintext export).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Imports/BackupPanel.tsx frontend/src/locales/fr/imports.json frontend/src/locales/en/imports.json frontend/src/pages/Imports/__tests__/BackupPanel.test.tsx
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "feat(backup): export passphrase is mandatory in the UI"
```

---

### Task 3: Demo mode — POST export handler

**Files:**
- Modify: `frontend/src/api/demo/handlers/writes/settings.ts:13-22`

**Interfaces:**
- Consumes: BackupPanel now always POSTs `/api/backup/export`.
- Produces: demo POST handler returning the demo state (demo data is fake — no real encryption needed; the download is a plain JSON of seed data).

- [ ] **Step 1: Swap the handler registration**

In `frontend/src/api/demo/handlers/writes/settings.ts`:

```ts
export function registerSettingsWriteHandlers(): void {
  registerHandler('PATCH', '/api/settings', handleSettingsPatch);
  // BackupPanel always POSTs since passphrases became mandatory. Demo data
  // is synthetic, so the handler just returns the seed state unencrypted.
  registerHandler('POST', '/api/backup/export', handleBackupExport);
}
```

Update the stale comment above `handleBackupExport` (it says the handler is unused; after this task it is used whenever demo mode intercepts fetch — verify whether demo intercepts raw `fetch()` or only `api()` calls by checking `frontend/src/api/demo/index.ts`; if raw fetch is not intercepted, note that in the comment and leave behavior as-is).

- [ ] **Step 2: Verify demo build compiles and suite passes**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/demo/handlers/writes/settings.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "feat(demo): backup export demo handler follows the mandatory-POST contract"
```
