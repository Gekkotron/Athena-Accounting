# Account-type help tooltip — design

**Date:** 2026-07-30
**Status:** approved

## Problem

On the online demo, the dashboard hero shows a "+ X € blocked" line whose
origin is unclear. The amount is driven by account types (investment) and
lock periods, but nothing in the UI explains what each account type means.
Users picking a type in the account form have no guidance.

## Decision

Add a "?" help icon next to the **Type** label in the account create/edit
form (`AccountForm.tsx`) — form only, not on the account cards. The tooltip
lists one example line per account type **and** a note explaining that
invested accounts and locked amounts are excluded from the available balance
and surface as "blocked" on the dashboard.

## Design

### 1. `InfoTip` gains rich content (`frontend/src/components/InfoTip.tsx`)

Signature becomes `{ text: string; children?: ReactNode }`:

- Popover content renders `children ?? text`.
- The trigger button's `aria-label` stays `text` (a plain-text summary).
- Backwards compatible — no existing call site changes.

### 2. `AccountForm.tsx` — Type label row

The Type field's label row becomes a flex row: `<label>` + `<InfoTip>`.
The `<label>` and `<select>` structure is preserved so the tests'
`fieldFor` helper (label → parent → control) keeps working: the flex
wrapper sits *around* the label, and the select stays a sibling of that
wrapper inside the field `<div>`.

Tooltip content: a small `<ul>` with one line per type
(`{typeOption} — {example}`) built from `form.typeOptions.*` +
`form.typeHelp.*`, followed by a separated note line (`form.typeHelp.note`).

### 3. i18n (`frontend/src/locales/{en,fr}/accounts.json`)

New `form.typeHelp` block:

| key | en | fr |
| --- | --- | --- |
| `aria` | Account type examples | Exemples de types de compte |
| `checking` | everyday account (salary, card payments) | compte du quotidien (salaire, paiements carte) |
| `savings` | Livret A, LDDS, PEL | Livret A, LDDS, PEL |
| `investment` | PEA, brokerage account, life insurance | PEA, compte-titres, assurance-vie |
| `credit` | credit card, loans | carte de crédit, prêts |
| `other` | cash, vouchers, anything else | espèces, titres-restaurant, autre |
| `note` | Invested accounts and locked amounts are excluded from your available balance and shown as "blocked" on the dashboard. | Les comptes placés et les montants bloqués sont exclus du solde disponible et affichés comme « bloqués » sur le tableau de bord. |

The words "blocked"/"bloqués" and "available"/"disponible" match the
dashboard hero's existing copy (`dashboard.json` `hero.blockedSuffix`,
`hero.available`).

## Testing

One Vitest case in `AccountForm.test.tsx`: render create mode, find the
tooltip trigger by its aria-label, hover it, assert a type example
(e.g. "assurance-vie") appears. Existing InfoTip behaviour (hover/focus,
portal) is already exercised by its floating-ui wiring; no separate
InfoTip test needed for the `children` pass-through beyond this.

## Out of scope

- Tooltip on the account card's type line (user chose form-only).
- Translating the raw `a.type` shown on `AccountCard` (pre-existing
  inconsistency, separate change).
