# i18n + Docusaurus site — Design

**Date:** 2026-07-16
**Status:** Draft, awaiting user review
**Scope:** Frontend UI internationalization (EN + FR, extensible) and a public documentation site built with Docusaurus.

## Goals

- Make the React frontend translatable, shipping English and French on day one, with a file layout that supports additional languages by dropping in a new locale folder.
- Publish a public documentation site at `https://gekkotron.github.io/Athena-Accounting/` that reads the existing `docs/` tree, offers a language switcher, and can host release notes and a landing page.
- Keep the app 100% functional in French throughout the migration — English coverage grows page by page, never regresses French UX.

## Non-goals

- Backend i18n (error messages, MCP responses, PDF/OFX parser status text). Backend stays English for now; can be revisited once the frontend migration lands.
- Translating the reference and contributors doc tracks. Only the user track gets French coverage in the first pass.
- Docs versioning (`docusaurus docs:version`). Deferred until there is a stable v1.0 to protect.
- A custom domain. GitHub Pages project URL is enough for launch; a CNAME can be added later with no pipeline changes.

## Architecture

### Frontend i18n

**Library stack**
- `i18next` (core), `react-i18next` (React bindings), `i18next-browser-languagedetector` (detects `navigator.language`).
- No new backend dependencies.

**Directory layout**

```
frontend/src/
├── i18n/
│   ├── index.ts               # i18next init, detector chain, namespace registration
│   └── LanguageSwitcher.tsx   # globe-icon dropdown, used in Layout header + Settings
├── locales/
│   ├── en/
│   │   ├── common.json        # save, cancel, loading, error, buttons
│   │   ├── layout.json        # nav, sidebar, user menu, header
│   │   ├── dashboard.json
│   │   ├── transactions.json
│   │   ├── imports.json
│   │   ├── rules.json
│   │   ├── accounts.json
│   │   ├── budgets.json
│   │   ├── settings.json      # includes Login + Profile pages
│   │   ├── pdf-template.json  # PdfTemplateBuilder subtree
│   │   ├── charts.json        # Sankey, BalanceChart, StatWidget
│   │   └── tips.json
│   └── fr/                    # mirror structure
```

**Language detection order** (first hit wins):
1. `localStorage.getItem('athena.lang')`
2. `navigator.language` — `fr-*` → `fr`, everything else → `en`
3. `'en'` (hard default)

**Fallback language** — `en`. If a key is missing in `fr.json`, the English string renders instead of an error placeholder.

**Key convention**
- Semantic keys, not English-worded: `t('header.title')`, not `t('Dashboard Title')`. A third language should not need to keep English as an identifier.
- Namespaced access: `const { t } = useTranslation('dashboard'); t('sections.moyennes.title')`.
- Interpolation and pluralization via built-in i18next: `t('imports.summary', { count })` uses `imports.summary_one` / `imports.summary_other` on the EN side and equivalent FR forms.

**Number & date formatting**
- Keep existing `formatAmount` helper. Update it to take (or read) the active locale and route through `Intl.NumberFormat(locale)`.
- EN users see `1,234.56 €`; FR users keep the current `1 234,56 €`.
- Tests that assert raw digit sequences (e.g. `70,00`) will need per-locale variants or a locale-neutral assertion (regex-based). Enumerated in Phase C migration commits.

**Runtime shape**
- `frontend/src/main.tsx` imports `./i18n` before rendering. `<Suspense fallback={…}>` wraps `<App />` so lazy-loaded namespaces don't flash empty strings.
- `LanguageSwitcher` calls `i18n.changeLanguage(next)` and writes to `localStorage`.
- No backend `/me` change; preference is device-local. Multi-device sync is a follow-up if needed.

### Docusaurus site

**Directory layout**

```
Athena-Accounting/
├── docs/                                # existing MD files (English source, unchanged)
│   ├── users/            # translated
│   ├── reference/        # EN only
│   └── contributors/     # EN only
├── website/                             # new Docusaurus workspace
│   ├── docusaurus.config.ts             # docs.path → '../docs'
│   ├── sidebars.ts                      # explicit ordering: users → reference → contributors
│   ├── package.json                     # its own node_modules, isolated from frontend/
│   ├── src/
│   │   ├── pages/index.tsx              # landing page (hero, features, screenshots)
│   │   └── css/custom.css               # brand palette
│   ├── static/                          # logo, favicon, og-image, screenshots
│   ├── i18n/fr/                         # French translations
│   │   └── docusaurus-plugin-content-docs/current/
│   │       └── users/                   # only user track translated
│   └── blog/                            # empty, ready for release notes
└── .github/workflows/docs.yml           # build + deploy on push to main
```

**Config essentials** (`website/docusaurus.config.ts`)
- `url: 'https://gekkotron.github.io'`
- `baseUrl: '/Athena-Accounting/'`
- `organizationName: 'Gekkotron'`, `projectName: 'Athena-Accounting'`
- `presets: [['classic', { docs: { path: '../docs', sidebarPath: './sidebars.ts', editUrl: 'https://github.com/Gekkotron/Athena-Accounting/edit/main/' }, blog: {}, theme: { customCss: './src/css/custom.css' } }]]`
- `i18n: { defaultLocale: 'en', locales: ['en', 'fr'] }`
- Navbar: logo + "Docs" (→ `/docs/users/getting-started`) + "Blog" + language dropdown + GitHub link.

**Frontmatter added to existing MD files** — lightweight, per file:

```md
---
sidebar_position: 1
title: Getting started
---
```

Twelve files across `users/`, `reference/`, `contributors/`. `README.md` files in each subfolder become category intros (Docusaurus supports `_category_.json` for finer control if needed).

**Docs i18n content flow**
- English is the source. FR pages live under `website/i18n/fr/docusaurus-plugin-content-docs/current/`.
- Docusaurus falls back to EN when a FR page is missing — that's the default and desired behavior.
- Only `docs/users/*` gets French copies in the first pass. Reference and contributors are English-only; the FR landing surfaces a small notice.

**Landing page** (`website/src/pages/index.tsx`)
- Hero: name + tagline ("Self-hosted personal accounting. Your bank data never leaves your network.")
- 3–4 feature cards: Imports (OFX / CSV / PDF), Categorisation (rules + Tri + transfers), Dashboard (Sankey + insights), Local-only (no cloud).
- App screenshot(s) below.
- CTAs: "Read the docs" → `/docs/users/getting-started`, "Star on GitHub" → repo.

**Blog** — enabled, empty. Ready for v0.2 release notes as the first post.

### Deploy pipeline

`.github/workflows/docs.yml`

- **Trigger**: `push` to `main` on paths `docs/**`, `website/**`, `.github/workflows/docs.yml`.
- **Permissions**: `pages: write`, `id-token: write`, `contents: read`.
- **Steps**:
  1. `actions/checkout@v4`
  2. `actions/setup-node@v4` with `node-version: 20` and `cache: 'npm'` scoped to `website/package-lock.json`
  3. `npm ci` in `website/`
  4. `npm run build` in `website/` (writes to `website/build/`)
  5. `actions/upload-pages-artifact@v3` with `path: website/build`
  6. `actions/deploy-pages@v4`
- **Repo settings**: Settings → Pages → Source = "GitHub Actions" (one-time manual step, documented in the follow-up commit's message).
- **Result**: site live at `https://gekkotron.github.io/Athena-Accounting/`.

## Migration plan

Commits land directly on `main` (per user's workflow). Each is self-contained and independently deployable. FR remains 100% functional throughout — English coverage grows page by page.

### Phase A — Docusaurus site (ship first)

Low risk, high visibility. No frontend changes.

- A1. Scaffold `website/` — Docusaurus config, `sidebars.ts`, empty blog, brand CSS.
- A2. Add frontmatter (`title`, `sidebar_position`) to twelve MD files in `docs/`.
- A3. Landing page (`src/pages/index.tsx`) with hero + feature cards + screenshots.
- A4. `.github/workflows/docs.yml` + enable Pages in repo settings.
- A5. Turn on FR locale with empty translations (falls back to EN). Docusaurus's built-in navbar language dropdown is visible from day one.

*Checkpoint: site is live. This is entirely disjoint from the frontend i18n work in Phase B — the site's language switcher is separate from the app's language switcher.*

### Phase B — Frontend i18n infrastructure (one commit)

App still 100% French. New machinery ready, only the language switcher and a "Loading…" fallback show English.

- B1. `npm install i18next react-i18next i18next-browser-languagedetector` in `frontend/`.
- B2. Create `frontend/src/i18n/index.ts` — init, detector chain, namespace registration.
- B3. Wrap `<App />` in `<Suspense>` for lazy namespace loads.
- B4. Seed `locales/en/common.json` + `locales/fr/common.json` with shared keys (`save`, `cancel`, `loading`, `error`, `retry`, `delete`, `edit`, `confirm`).
- B5. Add `LanguageSwitcher` component; mount in `Layout.tsx` header and Settings page.
- B6. Smoke test: render `<App />` with each locale, assert a common string.

*Checkpoint: language switcher works, English visible only in the switcher and shared common strings.*

### Phase C — Page migration (one commit per namespace, in visibility order)

Each commit extracts one feature's strings, adds EN + FR entries, wires `useTranslation`, updates tests.

- C1. `layout.json` — nav, sidebar, user menu, "Connecté", header.
- C2. `dashboard.json` — highest-traffic page.
- C3. `transactions.json`.
- C4. `imports.json`.
- C5. `rules.json`.
- C6. `accounts.json`.
- C7. `budgets.json`.
- C8. `settings.json` — includes Login + Profile.
- C9. `pdf-template.json` — largest namespace, PdfTemplateBuilder subtree.
- C10. `charts.json` + `tips.json` — cleanup pass.

Per-commit checklist:
- Grep the target files for FR string literals in JSX and attributes (`>Texte<`, `title="…"`, `placeholder="…"`, `aria-label="…"`, `alert(…)`, toast messages).
- Add keys to EN + FR namespace JSON files. English worded to be clean and clear (source of truth), FR mirrors current text.
- Replace literals with `t('…')` calls. Use interpolation for dynamic values; use pluralization forms where counts appear.
- Update tests: switch French literal assertions to locale-neutral (regex on digits, `data-testid`) OR add a dual-locale render pass.
- Manual verification: switch to EN in the running app, confirm no French leakage on the migrated page; switch back to FR, confirm no regressions.

### Phase D — Docs FR translations (parallel with C, low priority)

- D1–Dn. Translate `docs/users/*` files one at a time under `website/i18n/fr/docusaurus-plugin-content-docs/current/users/`. One commit per page. Reference and contributors tracks stay EN.

## Testing

**Frontend**
- Existing tests keep running against the FR locale (default in test setup) to catch regressions on the migrated pages.
- New smoke test in Phase B covers Layout in both locales.
- Per-namespace commit in Phase C adds a targeted test only if the current test relied on a French literal.
- Manual verification (`npm run dev` + language switcher) is the primary UI validation — automated dual-locale rendering of every page is out of scope for this migration.

**Docs**
- CI job runs `npm run build` in `website/` on every `docs/**` or `website/**` change. Build failure = broken doc site = blocked merge.
- No content-level tests (no link checker or spell check in this spec — can be added later).

## Risks and open questions

- **String leakage during Phase C**: it is easy to miss a string (attribute, toast, dynamically-built label). Mitigation: after each namespace commit, spot-check the migrated page in EN mode; the `LanguageSwitcher` makes this a two-click check. No automated leakage detector is proposed — the incremental commit boundary is the containment.
- **FR test brittleness**: existing tests assert French literals (e.g. `"70,00"` in transaction rows). Rewriting to locale-neutral assertions may reduce readability. Acceptable trade-off; noted per-commit in Phase C.
- **Docusaurus and `../docs` path**: Docusaurus supports out-of-tree `docs.path`, but hot-reload during dev may be slightly slower than the in-tree default. Not a launch blocker.
- **Sidebar drift**: adding a new MD file requires updating either its `sidebar_position` frontmatter or `sidebars.ts`. Documented in `website/README.md` as part of Phase A.
- **Backend user-facing strings**: import errors, MCP responses, and validation messages will remain English after this spec. If FR users report friction there, a follow-up backend i18n spec is needed — flagged but not scoped here.

## Rollout order recap

Phase A (Docusaurus site + empty FR) → Phase B (frontend infra + switcher) → Phase C (page-by-page migration, ~10 commits) → Phase D (FR docs translation, parallel with C).

Each phase is shippable in isolation. Nothing in Phase C blocks Phase A landing first, and nothing in Phase D blocks the app from going public.
