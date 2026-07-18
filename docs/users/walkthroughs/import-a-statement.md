---
title: Import a bank statement
sidebar_position: 1
---

# Import a bank statement

Athena accepts **OFX**, **QFX**, **CSV** (French format) and **PDF** bank statements. This guide walks you from dropping the file to verifying the balance.

## 1. Open the Imports page

From the sidebar, expand **Data** then click **Imports**. You land on the drop zone: the top banner recaps the accepted formats (OFX Latin‑1/UTF‑8, French CSV with `;` separator and comma decimal, `DD/MM/YYYY` dates, bank-statement PDFs).

![Imports page](/img/walkthroughs/en/import-01-imports-page.png)

## 2. Drop the file and pick the account

Drop your file into the **File(s)** zone — or click **Browse**. Pick the destination **account** in the dropdown on the right, then hit **Import**. The first time a PDF from a given bank is loaded, a wizard opens: you draw the **Date**, **Label** and **Amount** zones with the mouse. The template is remembered — subsequent imports from that bank are fully automatic.

## 3. Handle any duplicates

After the import, the **Duplicates** tab lists candidate transactions: two rows very close in date, amount and label. Review each pair and **Merge** or **Ignore**. Nothing is written without your confirmation.

![Duplicates tab](/img/walkthroughs/en/import-02-doublons.png)

## 4. Verify the control balance

Head to **Accounts** in the sidebar. Every account displays the balance Athena computed from the transactions on hand. Compare it to the closing balance printed at the bottom of your PDF statement — if it differs, a row was skipped during import, or a duplicate is still waiting to be handled.

![Balance check on the Accounts page](/img/walkthroughs/en/import-03-comptes-solde.png)

### Anchor a checkpoint

Once the balance is verified, turn it into a **checkpoint**. Click ▸ **Checkpoints** at the bottom of the account card to open the chronological drawer, then enter the statement date, the observed balance and an optional note ("Verified from the paper statement", for example).

Three reasons to do this now:

- **Integrity safeguard.** Every future import is silently compared to all past checkpoints. If a recomputed balance drifts from the reference by even one cent, Athena surfaces the delta — this is the only reliable way to catch a transaction lost during an import, or a duplicate merged in error months later.
- **History anchor.** Your accounts don't need to be "clean from day one". Anchor today's balance, import only the last few months, and Athena computes everything after that from this anchor.
- **Paper trail.** Every checkpoint carries a date and a free-form note — the most recent entries open at the top of the drawer, grouped by year.

![Checkpoints drawer on the account card](/img/walkthroughs/en/import-04-checkpoints.png)

On the **Dashboard**, checkpoints appear as diamonds along the balance curve — green when the computed balance matches, tinted when a drift is detected. Hover to read the exact delta between the expected and computed balance at that date.

![Checkpoint diamond on the balance curve](/img/walkthroughs/en/reports-04-balance-curve.png)

## Next steps

Imported transactions are waiting to be categorised. Continue with [Categorise transactions](./categorise-transactions.md) to create your first rules and automate the sort.
