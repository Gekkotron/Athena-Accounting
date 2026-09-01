---
title: Notifications
sidebar_position: 6
---

# Notifications

Athena can alert you when something in your ledger crosses a threshold you
set — a big purchase, a low balance, an overspent envelope, or a bank sync
that failed. Everything runs from your own server: alerts are computed
locally and delivered over the same connection your browser already has
open, with no cloud service involved.

Configure alerts in *Paramètres → Notifications*. A master toggle turns the
whole feature on or off; the settings underneath are split across three
tabs so each concern stays out of the others' way:

- **Canaux** — where alerts appear (in-app toast, browser notification).
- **Confidentialité** — what a notification is allowed to show on your
  screen.
- **Alertes** — which triggers are on and what their thresholds are.

Each trigger has its own toggle in the *Alertes* tab, so you can enable
only the ones you care about. New alerts show up as a badge on the bell
icon in the header and in the inbox at */notifications*.

## Big transaction

Fires when a single transaction on an account exceeds an amount you set for
that account. Set the threshold per account in the "Grosse transaction"
card of the *Alertes* tab — leave an account blank to never alert on it.
If several qualifying transactions land close together (an import, a bank
sync), Athena waits a couple of seconds and sends one summary notification
instead of one per row.

## Low balance

Fires when a transaction pushes an account's balance below a floor you set
for that account, same per-account layout as the big-transaction card. Only
one low-balance alert is sent per account per day, so a string of small
purchases while you're already under the floor doesn't spam the inbox.

## Envelope exceeded

Fires when spending in a budget envelope goes over the envelope's cap for
the current month. This one has a single on/off toggle — the cap itself is
whatever you already set on the envelope in *Budgets → Enveloppes*. At most
one alert is sent per envelope per month.

## Bank sync failed

Fires when a scheduled or manual [bank sync](./bank-sync.md) fails for a
connected account — an expired consent, an Enable Banking outage, or a
mapping issue. At most one alert is sent per account per day, so a sync
that keeps failing throughout the day won't flood your inbox; check the
connection card in *Données → Synchronisation bancaire* for the reason.

## Privacy mode

By default, notifications hide the two details that matter most if someone
glances at your screen or a lock-screen preview:

- **Masquer le montant** — replaces the amount with a placeholder in the
  notification's title and body.
- **Masquer le marchand** — replaces the merchant/label with a generic
  description of the trigger instead of the transaction text.

Both are on by default and can be turned off independently in the
*Confidentialité* tab of the Notifications settings if you'd rather see
the real numbers. The inbox at
*/notifications* always shows the full transaction detail — the privacy
toggles apply only to toast pop-ups and browser notifications, which appear
in more visible contexts (a shoulder-surfer at your screen).

## See also

- [Bank sync](./bank-sync.md) — connections, consent lifecycle, and sync
  troubleshooting.
- [Dashboard](./dashboard.md) — where budgets and envelopes are set.
