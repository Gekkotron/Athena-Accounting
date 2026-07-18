# Regenerating walkthrough screenshots

The PNGs backing the walkthrough docs are captured by a gated
Playwright suite: `frontend/e2e/walkthrough-screenshots.spec.ts`.
It ships in two modes — a VITE_DEMO fallback that needs no backend
and a real-backend mode that logs in against a running Athena
instance. Real-backend mode is the one that produces the shots
currently on gh-pages (no demo banner, real data).

The docs are bilingual. The suite writes into a shared,
per-language asset tree used by both the default-locale (English)
docs and the `website/i18n/fr/` mirror:

```
website/static/img/walkthroughs/
├── fr/   ← referenced from i18n/fr walkthrough docs
└── en/   ← referenced from the default-locale walkthrough docs
```

Pass `WALKTHROUGH_LANG=fr` (default) or `WALKTHROUGH_LANG=en` to
target the language. The suite also flips the Playwright browser
locale and forces the app's i18next language accordingly.

## What the suite captures

Four tests, one per walkthrough page. Every test writes into
`website/static/img/walkthroughs/<lang>/` with the exact filenames
the docs reference.

| Test | PNGs |
|------|------|
| `import-a-statement` | `import-01-imports-page.png`, `import-02-doublons.png`, `import-03-comptes-solde.png`, `import-04-checkpoints.png` |
| `categorise-transactions` | `categorise-01-transactions.png`, `categorise-02-tri.png`, `categorise-03-regles-liste.png` |
| `set-a-budget` | `budget-01-plafonds.png`, `budget-02-enveloppes.png`, `budget-03-dashboard-progress.png` |
| `view-reports` | `reports-01-dashboard.png`, `reports-02-dashboard-mid.png`, `reports-03-dashboard-bottom.png`, `reports-04-balance-curve.png` |

All shots use viewport `1440 × 900`, browser locale
`fr-FR`/`en-US` (driven by `WALKTHROUGH_LANG`), and dismiss the
welcome tour if it fires. Screenshots are viewport-only (`fullPage:
false`) so scrolling stays outside the frame.

## Real-backend mode (preferred)

Produces shots that match what a user sees after installing Athena
locally — sidebar shows `CONNECTÉ <user>`, no `Démo — vos actions…`
banner up top, real data throughout.

### Prerequisites

- A running Athena instance reachable from this machine (frontend +
  Fastify + Postgres, e.g. the LAN deployment).
- A seeded **demo user** on that instance with enough data to fill
  every screen the walkthroughs visit — accounts with balances,
  transactions across several months, rules, budgets, envelopes,
  categorised examples, a balance checkpoint. Empty states will
  make some shots look wrong.

### Run

Pass the URL and credentials as environment variables — never
commit them, never write them into files (public repo, LAN-only
deployment).

```sh
cd frontend

WALKTHROUGH_LOCAL_URL=http://<lan-host>:<port> \
WALKTHROUGH_LOCAL_USER=<demo-user> \
WALKTHROUGH_LOCAL_PASS=<demo-pass> \
WALKTHROUGH_LANG=fr \
WALKTHROUGH_SHOTS=1 \
npx playwright test e2e/walkthrough-screenshots.spec.ts
```

Re-run with `WALKTHROUGH_LANG=en` to capture the English shots into
`website/static/img/walkthroughs/en/`. The two languages share
identical filenames — the tests are locale-agnostic, only the UI
strings differ.

Add `-g "<test-name>"` to run one walkthrough, e.g.
`-g "set-a-budget"`. The whole suite takes ~40 s per language.

### What the env vars do

| Variable | Effect |
|----------|--------|
| `WALKTHROUGH_SHOTS=1` | Opts into the suite. Without it, every test is skipped so the demo smoke (`demo.spec.ts`) stays fast. |
| `WALKTHROUGH_LANG` | `fr` (default) or `en`. Sets the Playwright browser locale, forces the app's i18next language, and picks the output subfolder under `website/static/img/walkthroughs/`. |
| `WALKTHROUGH_LOCAL_URL` | `playwright.config.ts` reads this at load time. When set, it skips the VITE_DEMO webServer entirely and uses this URL as `baseURL`. |
| `WALKTHROUGH_LOCAL_USER` | Filled into the `input[autocomplete="username"]` field on `/login`. |
| `WALKTHROUGH_LOCAL_PASS` | Filled into the `input[type="password"]` field. |

The `beforeEach` in the spec only performs the login flow when
`WALKTHROUGH_LOCAL_URL` is set; otherwise it runs the VITE_DEMO
path unchanged.

## VITE_DEMO fallback

Useful when there's no backend around (e.g. spot-checking a UI
change) or when the shot needs to include the demo banner
(marketing, demo landing). Runs against a fresh `dist-demo/` served
by `vite preview` on port 4173.

```sh
cd frontend
WALKTHROUGH_SHOTS=1 npx playwright test e2e/walkthrough-screenshots.spec.ts
```

Playwright's `webServer` boots the demo build automatically. Some
walkthroughs (Enveloppes, Duplicates, Imports history, PDF
templates) render the `DemoUnavailableState` panel in this mode
because the underlying endpoints are stubbed — that's expected and
fine for demo-focused captures, wrong for the user-facing docs.

## Adding a new shot

1. Extend the relevant `test('...')` block in
   `walkthrough-screenshots.spec.ts`: navigate to the target route,
   `await page.waitForLoadState('networkidle')`, interact if
   needed, then `await shot(page, 'my-new-shot')`.
2. Reference `/img/walkthroughs/en/my-new-shot.png` (or `/fr/…`)
   from the walkthrough `.md`. Both language docs share the same
   filename per shot — only the folder differs.
3. Regenerate for **both** languages (`WALKTHROUGH_LANG=fr` and
   `WALKTHROUGH_LANG=en`); commit the spec change and both PNGs in
   the same commit.

If the shot needs an expanded panel, dropdown, or modal, use
Playwright's role-based locators (`getByRole('button', { name:
/Points de contrôle/i })`) rather than CSS selectors — the i18n
labels are stable, class names are not.

## Committing the output

Only stage what actually changed. `git status --short` after a run
often lists every walkthrough PNG because font-metric drift and
demo-seed timing cause 1-byte differences even when the visible
content is identical. Diff each file visually (`git diff --stat`
gives you the byte delta; open the file in Preview / your editor
to eyeball) before committing — a walkthrough shot that regressed
into an error state or lost data should not sneak in.

Keep credentials + LAN URLs out of the commit message too. The
existing history (`docs(users): re-shoot …`) is a good template.

## Troubleshooting

- **Login times out on `waitForURL('**/', …)`** — the credentials
  are wrong, or the backend is not routing `/api/auth/login`.
  Reproduce the flow in a real browser first.
- **Welcome-tour modal is captured in the shot** — the tour
  dismissal in `beforeEach` timed out. Bump the `3_000` waits in
  `dismissWelcomeTour()` or dismiss the tour manually in the demo
  account before running.
- **RTK proxy shows connection refused but a browser reaches the
  host fine** — use system `/usr/bin/curl` to verify; RTK
  occasionally reports false negatives on LAN hosts.
- **Playwright says "browser not installed"** — one-time setup:
  `npx playwright install --with-deps chromium` from `frontend/`.
