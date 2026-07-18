---
title: Categorise transactions
sidebar_position: 2
---

# Categorise transactions

A properly categorised transaction feeds the dashboard, the budgets and the reports. Athena offers three routes: single-row edits, assisted bulk sorting, and automatic rules that take over from there.

## 1. Edit a category inline

Open **Transactions** from the sidebar. Every row exposes a **Category** picker you can edit directly — no modal, no round-trip. The filters at the top (account, period, search) let you isolate a batch before flipping a series of rows.

![Transactions page with inline-editable categories](/img/walkthroughs/en/categorise-01-transactions.png)

## 2. Sort in bulk from the "Sort" workshop

For a first sweep over a freshly loaded import, open **Rules → Sort**. The workshop groups uncategorised transactions by label pattern — assign the category once and the whole batch follows. On each assignment, Athena offers to **turn the batch into a rule** so future identical labels get sorted on their own.

![Sort workshop grouped by pattern](/img/walkthroughs/en/categorise-02-tri.png)

## 3. Create a rule from a transaction

On an individual transaction, the **Create a rule** button opens a form pre-filled with the detected pattern (contains, starts with, regular expression). Set the target category, the scope (which accounts it applies to) and confirm — the rule runs retroactively on history and automatically on future imports.

## 4. Manage and prioritise rules

The **Rules → List** tab shows all your rules, in evaluation order. **Internal transfer** rules (between two of your own accounts) are flagged: they neutralise the transaction in spending reports. Reorder by drag-and-drop if two rules overlap.

![Rules list with internal transfers highlighted](/img/walkthroughs/en/categorise-03-regles-liste.png)

## Next steps

Once your categories are clean, move on to [Set a budget](./set-a-budget.md) to place a monthly cap on each of them.
