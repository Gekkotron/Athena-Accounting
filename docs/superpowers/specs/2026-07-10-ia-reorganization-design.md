# Spec #1 — Information Architecture Reorganization

**Date:** 2026-07-10
**Status:** Design approved, awaiting user review
**Author:** Gekkotron + Claude (brainstorming session)
**Parent programme:** Athena Accounting full redesign (spec 1 of 7)

## Context

The current top-level sidebar has 8 flat items: Dashboard, Transactions, Tri,
Catégories, Budgets, Règles, Comptes, Imports / Sauvegarde.

Four of those items (Tri, Règles, Catégories, Budgets) all address the same
mental slot — "how are transactions classified?". Two more (Comptes, Imports)
each hide multiple unrelated sub-tools inside a single page:

- **Comptes** contains: account list, filename patterns (`PatternsSection`),
  and balance checkpoints (`BalanceCheckpointsDrawer`).
- **Imports** contains: upload form, duplicates panel, PDF templates list,
  backup panel, imported-files list.

The flat nav grew organically as features shipped. It no longer signals the
workflow phases of a bank-statement-first accounting tool.

## Goals

- Reduce top-level nav from 8 items to 6 (spread across 3 sections), without hiding features.
- Group by workflow phase: **Every day**, **Classification**, **Structure**.
- Elevate hidden sub-tools (filename patterns, PDF templates, duplicates,
  backup) to deep-linkable, discoverable pages. Balance checkpoints stay in
  the per-account drawer (extraction requires component redesign — deferred).
- Zero visual or component redesign — this spec is IA only.
- All old URLs redirect to their new home; bookmarks keep working.

## Non-goals

- No colour, typography, spacing, or component-library changes. Those land
  in spec #2 (design tokens).
- No chart or visualization changes (spec #3).
- No dashboard rethink (spec #4).
- No feature-page redesign (spec #5).
- No onboarding or empty-state work (spec #6).
- No mobile pass beyond ensuring the new drawer works (spec #7).
- No new UI for `transfer-rules` — the API stays; no nav item spent on it.

## Final nav shape

```
── Tous les jours ──
📊 Dashboard             /
💳 Transactions          /transactions
🎯 Budgets               /budgets

── Classification ──
🏷  Règles               /regles          ▾ (expandable)
   • Tri                 /regles/tri      ← default when parent clicked
   • Règles              /regles/liste
   • Catégories          /regles/categories

── Structure ──
🏦 Comptes               /comptes         ▾
   • Comptes             /comptes         ← default
   • Motifs de fichier   /comptes/motifs
📥 Données               /donnees         ▾
   • Imports             /donnees/imports ← default
   • Doublons            /donnees/doublons
   • Modèles PDF         /donnees/modeles
   • Sauvegarde          /donnees/sauvegarde

── (bottom of sidebar) ──
👤 Profil                /profil
⚙  Réglages              /reglages
🔒 Masquer les montants
↩  Se déconnecter
```

## Feature moves

| Before | After |
|---|---|
| `/tri` (`pages/Tri.tsx`) | `/regles/tri` — move to `pages/Rules/Tri.tsx` |
| `/rules` (`pages/Rules/index.tsx`) | `/regles/liste` — same file |
| `/categories` (`pages/Categories.tsx`) | `/regles/categories` — move to `pages/Rules/Categories.tsx` |
| `/accounts` account list section | `/comptes` |
| `/accounts` → `PatternsSection` | `/comptes/motifs` — own route, no drawer |
| `/accounts` → `BalanceCheckpointsDrawer` | Stays inside `AccountCard` on `/comptes` — extraction deferred (requires component redesign, out of IA-only scope) |
| `/imports` → `UploadForm` + `FileImportsList` | `/donnees/imports` |
| `/imports` → `DuplicatesPanel` | `/donnees/doublons` |
| `/imports` → `PdfTemplatesPanel` | `/donnees/modeles` |
| `/imports` → `BackupPanel` | `/donnees/sauvegarde` |

No component is rewritten in this spec. Pages that currently render multiple
panels vertically are split so each panel becomes its own route.

## Sub-nav pattern

Every hub uses the same rule: **sidebar expands and in-page tab strip syncs
to the URL**. Both surfaces stay authoritative — the user can switch via
either.

- Clicking the parent (`Règles`, `Comptes`, `Données`) navigates to the
  default child listed above and expands the sidebar section.
- Clicking a sub-item navigates directly; sidebar reflects the active child.
- The page renders a tab strip at the top; tabs match the sidebar children
  and drive the same URL changes.
- Deep links (`/regles/tri`, etc.) are canonical and shareable.

## Redirect policy

Every old URL redirects (`<Navigate replace to="…" />`) to its new home so
bookmarks and any external references stay valid:

```
/tri         → /regles/tri
/rules       → /regles/liste
/categories  → /regles/categories
/accounts    → /comptes
/imports     → /donnees/imports
```

The `settings` and `profile` routes stay where they are (`/settings`,
`/profile`) but are relabelled to `/reglages` and `/profil` in French with
redirects from the old English slugs.

## Mobile behaviour

The mobile drawer inherits the sectioned structure:

- Section labels (`Tous les jours`, `Classification`, `Structure`) render as
  short header rows using the sidebar's existing muted-label style; no new
  typographic tokens are introduced.
- Each hub row (`Règles`, `Comptes`, `Données`) is tap-to-expand
  (accordion). Only one hub may be expanded at a time to keep the drawer
  short.
- Sub-items indent one level inside their parent.
- Tapping a sub-item closes the drawer and navigates.

## User card (bottom of sidebar)

- Keep the existing card (username, gear, privacy toggle, logout).
- Small correction: today the username is the link to `/profile`, which is
  not discoverable. Add a small "Profil" row above the gear so the profile
  link is explicit.
- No visual redesign in this spec.

## Architecture — new files and changes

**New:**

- `frontend/src/components/HubLayout.tsx` — shared shell that renders the
  in-page tab strip driven by the current URL and its child routes. Used by
  `/regles/*`, `/comptes/*`, `/donnees/*`.
- `frontend/src/pages/Rules/Tri.tsx` — moved from `pages/Tri.tsx`.
- `frontend/src/pages/Rules/Categories.tsx` — moved from `pages/Categories.tsx`.
- `frontend/src/pages/Accounts/Patterns.tsx` — extracts `PatternsSection`
  wrapper into a page.
- `frontend/src/pages/Data/Imports.tsx` — wraps `UploadForm` + `FileImportsList`.
- `frontend/src/pages/Data/Duplicates.tsx` — wraps `DuplicatesPanel`.
- `frontend/src/pages/Data/PdfTemplates.tsx` — wraps `PdfTemplatesPanel`.
- `frontend/src/pages/Data/Backup.tsx` — wraps `BackupPanel`.

**Changed:**

- `frontend/src/components/Layout.tsx` — new sectioned nav array (three
  sections, each an array of items with optional `children`). Rendering
  supports the expand/collapse behaviour and the accordion drawer.
- `frontend/src/App.tsx` — route tree reshaped into three hub groups with
  redirect-only parent routes and `<Route index element={<Navigate />} />`
  for defaults; plus five legacy redirects.
- `frontend/src/components/NavIcons.tsx` — add icons for the new hubs if
  needed; drop icons for routes that no longer sit at the top level.

**Removed:**

- `frontend/src/pages/Tri.tsx` (moved).
- `frontend/src/pages/Categories.tsx` (moved).
- Nothing else is deleted. `BalanceCheckpointsDrawer` is untouched.

## Interfaces

`HubLayout` is the only new abstraction. Contract:

```ts
type HubTab = { to: string; label: string; end?: boolean };

function HubLayout({
  title,          // "Règles", "Comptes", "Données"
  tabs,           // ordered list of { to, label }
  children,       // <Outlet /> at the call site
}: {
  title: string;
  tabs: HubTab[];
  children: ReactNode;
}): JSX.Element;
```

Consumers do not need to know how the tab strip is styled or how the URL
sync works. Adding a fourth tab means adding one entry to the `tabs` array
and one route in `App.tsx`.

## Testing

- One `__tests__/Layout.test.tsx` case per section: rendering, section
  labels, hub-expand behaviour, active-state highlighting.
- One `__tests__/HubLayout.test.tsx` case: URL-driven active tab, tab click
  navigation, keyboard focus behaviour.
- Per moved page: rename the existing test file and update the router
  wrapper's initial URL. Component behaviour is unchanged, so tests should
  pass verbatim after the URL update.
- One `__tests__/redirects.test.tsx` case per legacy URL, asserting the
  new URL renders.

## Rollout

- Ship as one PR. No feature flag. The move is mechanical and every old URL
  is redirected, so users see the new structure on next page load with no
  broken links.
- No migration, no data change, no backend change.

## Open questions

None. Approved sections 1–4 in the brainstorming session.

## Next steps after this spec

- Write the implementation plan (`writing-plans` skill).
- Ship the implementation on `main` (per project convention: no branches).
- Move on to spec #2 (design tokens & primitives), which will be the first
  visual pass on top of this new IA.
