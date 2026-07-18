---
title: Accounts and data
sidebar_position: 6
---

# Accounts and data

Everything that lives outside individual transactions: the **Accounts**
page — where you shape the accounts that back every balance — and the
**Data** tab, where imports, duplicates, PDF templates, and backups
live.

## Creating an account

Go to *Accounts → New account*. Every account needs five things:

| Field | What it means |
|-------|---------------|
| **Name** | Free text — shown on cards, in transaction lists, and in the account picker. |
| **Type** | `checking`, `savings`, `investment`, `credit`, or `other`. The type influences styling and a couple of aggregates, not the balance math. |
| **Currency** | ISO 4217 code (EUR, USD, GBP…). Displayed as a badge on every card. |
| **Opening balance** | The balance on the opening date. Every reported balance is `opening_balance + SUM(amount WHERE date >= opening_date)`, so this number is load-bearing — get it right on day one. |
| **Opening date** | The date the opening balance is taken as of. Usually the day before the earliest transaction you plan to import. |

An optional **lock period** (in years) marks the opening balance and
untagged transactions as blocked money — see *"Locked money"* below.

## Editing an account

Every card on the *Accounts* page has a small **pencil** in the top
right. Clicking it opens an inline editor with the same fields as the
create form. Changes to opening balance and opening date recompute
every running balance for that account — the balance chart, the
Dashboard trend, and any checkpoints all update.

The inline editor also holds the **Delete** button. Deletion is
refused by the server if the account has any transactions — move or
delete those first, or use the merge flow below.

## Currency

Each account is single-currency. Athena does not do FX conversion —
cards, charts, and totals display in the account's own currency, and
the Dashboard groups totals per currency when accounts span more than
one. If you hold the same physical account in two currencies, model
it as two Athena accounts.

## Marking an account as invested

Setting **type = investment** does two things:

- The card shows an *"invested"* tag under the amount, so investment
  balances read differently from cash.
- The Dashboard treats the balance as part of net worth but excludes
  investment inflows and outflows from the income/expense breakdown —
  investment moves are transfers of your own money, not spending.

Use it for brokerage accounts, PEA/PEA-PME, life insurance, and any
account where the balance is money you own but wouldn't spend from
day to day.

## Locked money: *Available* vs *blocked*

For accounts that hold money you can't withdraw on demand — PEA,
dépôt à terme, blocked savings — the card can show *Available* and
*blocked* portions side by side:

- Set a **lock period** (in years) on the account.
- Any transaction older than `today − lockYears` is treated as
  blocked; the remainder is *Available*.
- The card shows `of which X locked` when the split is non-zero.

Individual transactions can also carry their own lock override, so a
single early-withdrawal moves that amount into *Available* without
touching the rest.

## Reordering accounts

The *Accounts* grid supports drag-to-reorder — the six-dot handle in
the top-right corner of each card. Order is saved as soon as you drop.
The same order is used everywhere: the Dashboard account scope picker,
the transactions filter, and the balance chart legend.

Keyboard reorder works too: tab to the handle, press *Space* to grab,
arrow keys to move, *Space* to drop.

## Merging duplicate accounts

If you accidentally created two accounts for the same real-world
account — a common outcome of importing from two banks that both list
a joint account — use the **kebab menu → Merge with…** action on the
duplicate card.

The merge modal only offers same-currency destinations. It moves
every transaction on the source into the target, adds the source's
opening balance to the target's, repoints checkpoints and filename
patterns, and deletes the source. The action is irreversible;
Athena warns before running it.

Transfer links between the source and other accounts are broken by
the merge — re-run categorization if you rely on transfer detection.

## Balance checkpoints on the account card

Each account card has an expandable *"checkpoints"* drawer at the
bottom — the same checkpoints surface as the import walkthrough
covers. Checkpoints anchor the running balance to a bank statement so
drift shows up as a visible gap on the trend chart.

The full walkthrough (adding a checkpoint, editing one, and what the
diamonds on the chart mean) lives on the [Importing](importing.md)
page — see the *"Balance checkpoints"* section there, cross-linked
from the drawer.

## The Data tab

Everything file-shaped lives under **Data** in the top nav. It has
four sub-tabs:

| Sub-tab | What it does |
|---------|--------------|
| **Imports** | Drop OFX / CSV / PDF files and watch them land. Multi-file drops, per-file summaries, and the audit log for previously imported files live here. See [Importing](importing.md). |
| **Duplicates** | Athena silently dedupes on import, but if a duplicate slips through (same day, same amount, different label), the Duplicates panel shows near-matches side by side and lets you merge or dismiss. |
| **PDF templates** | The templates painted by the wizard on first import. Rename, inspect, or delete them here. Deleting a template forces the next matching PDF back through the wizard. |
| **Backup** | Export everything (accounts, categories, rules, transactions, checkpoints, file-import audit) as one JSON envelope, or restore from one. Restore is destructive — Athena confirms before wiping. See [Backup and recovery](backup-recovery.md). |

The Data tab is intentionally the only place that touches files. If
you're looking for a control that reads or writes something external,
it's on one of these four screens.

## Where to go next

- **[Importing](importing.md)** — every format, template painting,
  checkpoints in depth.
- **[Categorization](categorization.md)** — once accounts hold
  transactions, sort them into categories.
- **[Backup and recovery](backup-recovery.md)** — the export/import
  contract in full, plus per-OS data-directory locations.

← [Back to user docs](README.md)
