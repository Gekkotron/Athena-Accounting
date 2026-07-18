---
slug: browser-only-demo
title: Try Athena in your browser — no install, no signup
authors: [Gekkotron]
tags: [demo, release, frontend]
draft: true
---

Athena Accounting now has a fully interactive demo running in the
browser at
[**gekkotron.github.io/Athena-Accounting/demo/**](https://gekkotron.github.io/Athena-Accounting/demo/).
No account, no server, no download. Everything the app does — dashboard,
transactions, budgets, categorisation, rules — is wired to a
localStorage-backed adapter and pre-seeded with six months of plausible
French bank data.

<!-- truncate -->

## Why a browser demo?

The install page has always been the friction point. Even the desktop
build asks the visitor to trust an unsigned binary. The demo removes
every barrier between "I read about Athena on GitHub" and "I've clicked
through the dashboard for two minutes." The tradeoff is that anything
requiring a real backend — parsing PDF statements, OCR-ing bank
photos, minting MCP tokens — pops a friendly "not available in the
demo" modal instead. Everything else works.

## How it works

The demo is the same Vite build as the desktop app, gated by a
`VITE_DEMO=1` flag. When the flag is on, the frontend's API client
routes every call through a small adapter under
`frontend/src/api/demo/`. The adapter owns:

- **Store.** A versioned JSON blob in localStorage. Every mutation
  goes through `setState()` which persists with a 250 ms debounce and
  notifies subscribers.
- **Seed.** A deterministic six-month narrative — two accounts,
  ~180 transactions across recurring and discretionary buckets, three
  budgets, five rules, one balance checkpoint that matches the
  computed balance so the dashboard shows a green diamond.
- **Handlers.** Every read endpoint the app touches (accounts,
  transactions, four report shapes, tri groups) computes from the
  store on the fly. Every write mutates the store and re-broadcasts.
- **Stubs.** Endpoints that need a real server (imports, PDF
  templates, MCP tokens) reject with a typed
  `{ demoStub: true }` error; the shared `errorMessage` helper picks
  that up and returns the French copy.

## Reset

A banner at the top of every page in the demo build lets the visitor
reset the store to the pristine seed. TanStack Query's cache is
invalidated in the same tick so the UI re-fetches immediately. The
banner is compile-time gated on `VITE_DEMO` — production builds
never see it.

## Deploy

The docs workflow now builds the demo alongside the Docusaurus site
and merges `frontend/dist-demo/` into `website/build/demo/`. Both
deploy through the same GitHub Pages step, so the docs URL and the
demo URL share the same origin. The demo's Vite `base` is set to
`/Athena-Accounting/demo/` so hashed asset URLs resolve; the router's
`basename` reads the same value from `import.meta.env.BASE_URL`.

## What it doesn't do

- No import of your own bank statements. That's what installing
  Athena is for — and the demo says so explicitly when you try.
- No syncing between visitors. Your localStorage is your own.
- No server-side rendering. It's a Vite SPA behind an iframe on the
  docs page; SEO of the demo page itself is not a goal.

## Install to keep

If you like what you see, the install paths are the same as before:
the [Docker family server](/docs/users/getting-started) or the
[desktop app](/docs/users/desktop-install). Both give you the parsed
imports, the PDF templates, the MCP endpoint, and a real backup file
you can carry between machines.
