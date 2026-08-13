---
title: Savings goals
sidebar_position: 6
---

# Savings goals

Set aside part of an account for something specific — a holiday, an
emergency fund, the next big purchase — without splitting the account
itself. A savings goal is an **intention** stacked on top of your real
balance: it doesn't move a euro of your ledger, and creating a goal
doesn't create a transaction. You record contributions and withdrawals
against the goal separately.

Because goals live above the ledger, one account can host as many as
you like. A single Livret A can carry *Vacances 2 000 €* alongside
*Fond d'urgence 5 000 €* alongside a general *Buffer*, and the
progress of each is tracked independently.

## What a savings goal is

Each goal has:

- **A name** — anything, up to 128 characters.
- **A target amount** — must be strictly positive, kept in the account's
  currency (Athena has no FX yet — see [Accounts and data](accounts-and-data)).
- **A target date** — optional. When set, it drives the "X € / month
  needed" projection and the "N days overdue" warning.
- **A color** — optional accent.
- **A history of events** — every contribution and withdrawal you
  record, each with a date and an optional note.

There's no status enum. A goal is either *open* (`closed_at` NULL) or
*closed* (archived, non-null). Closing a goal doesn't delete anything —
you can reopen it later, or delete it explicitly if you want the
history gone.

## Creating a goal

Two entry points:

- **From the Goals page** (`Objectifs` in the sidebar): the
  `Nouvel objectif` button opens a modal to pick the account, name,
  target, and — optionally — a deadline and a color.
- **From the Comptes page**: each account card carries a compact
  Objectifs strip with a `+ Nouvel objectif` chip that opens the same
  modal, preselected on that account.

Athena rejects a non-positive target (400 error surfaced inline) and a
duplicate `(account, name)` pair (409 with a French message). The name
uniqueness is scoped per account — you can have *Vacances* on the
Livret A and *Vacances* on the Compte courant without a conflict.

## Recording a contribution or a withdrawal

Open a goal (click a card) and use the *Enregistrer un versement* form
in the drawer:

- **Amount** — positive numbers are contributions, negative numbers are
  withdrawals. Zero is rejected.
- **Date** — defaults to today. Any date is accepted, including past
  dates for backfilling.
- **Note** — optional, capped at ~500 characters.

The event lands in the ledger of *the goal*, not the ledger of the
underlying account. The account's real balance stays untouched.

**Reached your target?** The response from Athena includes a
`justReached` flag on the transition that first crosses the target from
below — the app fires a one-shot success toast. Goals don't auto-close
on completion; you close them explicitly when you're ready to archive
them. Overshooting is fine and displays as "108 % réalisé" on the card.

## Deadlines and projections

When you set a target date:

- **Future date** — the card shows `↣ X € / mois pour tenir la date`.
  The number is `ceil((target − saved) / months_remaining)` where
  months are the mean Gregorian month (30.44 days), rounded up so the
  advice always errs on "a bit more than the math says".
- **Past date + still under target** — the card shows
  `en retard de N jours`. The monthly projection disappears; setting a
  new target date brings it back.
- **Past date + already reached** — Athena treats the goal as done and
  hides both clauses. Close it when you're ready.
- **No target date** — both clauses are hidden. This is the right
  choice for open-ended saving (an emergency fund).

## Closing versus deleting

- **Close** (`Clore l'objectif`) archives the goal. It disappears from
  the Goals list by default, but the "Afficher les objectifs clos"
  toggle brings it back. Events are preserved. Close a reached goal to
  clear the visual clutter; close an obsolete one for the same reason.
- **Reopen** flips the switch back — no data was lost.
- **Delete** (red button at the bottom of the drawer, guarded by a
  confirmation dialog) removes the goal *and* every event attached to
  it. This is irreversible.

## The Comptes strip and the Dashboard widget

Beyond the dedicated Goals page:

- **Comptes → each account card** — a compact "Objectifs" strip lists
  the account's non-closed goals with a mini progress bar. Clicking a
  row deep-links to `/goals?highlight=<id>`, which scrolls the goal
  into view and ring-highlights it. The `+ Nouvel objectif` chip
  routes back to the same page with the create modal open on the
  correct account.
- **Dashboard → Objectifs à venir** — up to three goals sorted by
  soonest deadline (nulls last, tie-break on the least-full one). The
  section renders nothing when you have no goals yet.

An amber warning appears on an account section header when the sum of
all non-closed goals exceeds the account's current balance:
`Vous avez réservé plus que votre solde disponible sur ce compte.` This
is advisory only — Athena is a retrospective ledger, and the intent
often precedes the money.

## Backup

Savings goals travel inside the standard JSON backup: two optional
arrays (`savingsGoals` and `savingsGoalEvents`) join the payload. They
use natural keys on restore:

- A goal remaps by `(account name, goal name)`.
- An event remaps to the resolved goal via the same pair.
- Goals whose account did not restore are silently skipped, with the
  count surfaced in the restore summary. Same treatment for events
  whose parent goal is missing.

Old backups (from before this feature shipped) restore fine — the
optional arrays default to empty.

## Privacy

Every amount displayed on the Goals page, the AccountCard strip, and
the Dashboard section respects the same privacy blur you already use
elsewhere. Numbers are covered by the `private` class and hidden when
you toggle blur mode (Ctrl-J on desktop; see
[Security and privacy](security-and-privacy)).

## See also

- [Accounts and data](accounts-and-data) — how balances behave and the
  account currency inherited by a goal.
- [Categorization](categorization) — the categorised transactions
  ledger sits alongside savings goals but is independent from them.
- [Backup and recovery](backup-recovery) — where the JSON dump comes
  from and how restore natural-keys resolve.
