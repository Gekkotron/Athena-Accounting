---
title: Categorization
sidebar_position: 4
---

# Categorization

Athena categorizes transactions two ways: **rules** that run on every
import, and **manual assignment** via the Sort tab. Every
transaction carries a **source** tag — `auto`, `default`, or `manual` —
that decides who owns its category the next time rules are re-applied.
This page walks through both paths, how transfer rules keep internal
moves out of your income and expense totals, and what "regenerate
categories" actually does.

## The rule engine

Rules are keyword-to-category assignments configured in **Rules**. On
every import Athena walks your enabled rules in priority order (highest
first, ties broken by rule id) and stamps the first matching rule's
category onto the transaction. Unmatched transactions fall into the
built-in `Divers` (default) category.

Matching is:

- **Accent- and case-insensitive.** `carrefour`, `CARREFOUR`, and
  `Carrefour` all match — Athena normalises both the keyword and the
  transaction label before comparing.
- **Whole word by default.** `paye` won't match `payweb`. Switch a
  rule to **Substring** for a looser match, or to **Regex** for full
  control (the pattern is applied to the already-normalised label).
- **Sign-guarded.** A rule can be restricted to positive-only or
  negative-only amounts. That's how you keep a `salaire` rule from
  catching a refund on your credit card, or a `carrefour` rule from
  catching a refund from Carrefour.

Create rules from the **Rules** page: type one or several keywords
(comma-separated), pick a category, set the match mode, sign
constraint, and priority. Every keyword becomes its own rule pointing
to the same category.

## The Sort tab

The Sort tab is where you deal with everything the rules didn't catch.
Athena groups uncategorised transactions (and transactions that fell
into `Divers`) by **normalised label** — so `CARREFOUR CITY 12/03` and
`CARREFOUR MARKET 04/06` land in the same bucket — and sorts the
buckets by frequency, so the biggest wins are always at the top.

### Bulk assignment

Tick the checkbox next to each group you want to handle, pick a
category from the **Bulk** dropdown, and click **Apply to selection**.
Every transaction in every selected group is assigned in one shot.

### Single-group assignment

Prefer to eyeball one bucket at a time? Each row has its own category
dropdown and an **Apply** link on the right. Same effect, one group at
a time.

### Turn an assignment into a rule

The **Create rules** checkbox (on by default) tells Athena to also
create a rule for the group's normalised label as it assigns. That
way, next month's `CARREFOUR CITY 04/07` gets picked up automatically
at import time — you only pay the sorting cost once per merchant.
Uncheck the box to sort without leaving rules behind.

## Regenerating categories

The **Recategorize** button (top-right on both **Rules** and **Sort**)
replays every enabled rule against every existing transaction. Use it
after adding new rules, changing priorities, or importing history from
before those rules existed.

By default, **manual choices are preserved**: only transactions with
source `auto` (previously matched a rule) or `default` (fell into
`Divers`) are re-evaluated. Anything you touched by hand keeps its
category. The result banner shows four counters: total scanned,
recategorised, still-unknown, and preserved manual.

## Internal transfer rules

When you move money between two of your own accounts, both legs land
in your imports as ordinary expense and income lines. Athena's
transfer detector pairs them via a shared `transfer_group_id` and
excludes them from income/expense aggregates so they don't inflate
your totals.

Transfer rules live at `/api/transfer-rules` and pair a **keyword**
(e.g. `virement compte joint`) with a **direction** (`outgoing` or
`incoming`) and, optionally, a specific counterpart account. Once a
rule matches an incoming leg, Athena looks for the mirror leg in the
counterpart account within ±7 days and links the two. The UI for
these is currently minimal — most users configure them via the API or
by importing a backup that already contains them.

## How sources interact

Every transaction stores a **source** that tells Athena where its
category came from:

- **`auto`** — assigned by the rule engine at import time.
- **`default`** — fell through every rule and landed in `Divers`.
- **`manual`** — you set the category, either from the Sort tab, from
  a transaction's inline edit, or in the transaction modal.

The source drives two behaviours:

- **Editing.** Assigning a category on a transaction — inline in the
  table, in the modal, or via the Sort tab — flips its source to
  `manual`. Retroactive rule re-application then leaves it alone.
- **Re-importing.** Re-importing the same file is safe: dedup skips
  the rows that are already there (see [Importing](importing.md)), so
  your manual choices survive re-imports untouched. New transactions
  in the file are categorised by the rule engine and start life as
  `auto` or `default` — never `manual`.

To wipe manual overrides and start fresh, run **Recategorize** and
pass `{"preserveManual": false}` on the API call directly — the UI
always uses the safe (preserving) mode.

*See also:* [Importing](importing.md) · [Dashboard](dashboard.md)

← [Back to user docs](README.md)
