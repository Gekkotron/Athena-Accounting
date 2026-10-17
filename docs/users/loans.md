---
title: Loans
sidebar_position: 6
---

# Loans

Follow every loan you're repaying — mortgage, car, consumer credit — and
see, at any time, **how much capital you still owe**, **when the loan
ends** and **what it really costs**: interest + insurance + fees +
early-repayment penalties.

Loans live on their own page (**Loans** in the sidebar). They don't touch
your accounts or transactions.

## Create a loan

**New loan** asks for:

- **Amount borrowed**, **first instalment** date, **interest rate** (% per
  year, nominal — the rate on your loan offer).
- **Insurance rate** (% per year; `0` for most consumer loans) and whether
  your insurer charges it on the **initial capital** (same amount every
  month) or on the **capital owed** (decreasing).
- **One-off fees**: application fee, guarantee, broker.

Then the **timeline**:

- **Periods before the last one** — optional. Each is a number of months
  and a kind:
  - *Payment*: you pay a fixed monthly amount (e.g. a reduced first
    phase).
  - *Partial deferral*: you pay only the interest (and insurance); the
    capital doesn't move — typical while a house is being built.
  - *Total deferral*: you pay nothing but insurance; the interest is added
    to the capital owed.
  - Each period can have its own rate (variable rate, renegotiation).
- **Last period** — Ledger computes what you don't know:
  - *I know the end date* → it computes the monthly payment;
  - *I know the monthly amount* → it computes the end date.
- **Early repayments** — a lump sum on a month, which either **lowers the
  payment** (end date kept) or **shortens the loan** (payment kept), plus
  the penalty your bank charges.

The preview updates as you type. Amounts accept French or English
formatting (`245 000`, `3,85`).

## Read a loan

Open a card to see capital owed today, the share already repaid, interest
paid so far, months left, the total cost broken down, a chart of the
capital owed, the list of periods and the full schedule grouped by year.
An instalment counts as paid once its date has passed.

**Change payment from…** handles "from March my payment goes up to
1 400 €": earlier instalments are kept as they were and the end date is
recomputed.

## What-if and simulations

**What-if** lets you try an early repayment, a new payment or a new rate
and compares the result with the current loan (end date, monthly payment,
total cost, money saved). Then **Discard**, **Apply to loan**, or **Save as
simulation**.

Simulations live in the **Simulations** tab. One saved from a loan keeps
showing the comparison with that loan; if you delete the loan, the
simulation stays. **New simulation** also works for a loan you don't have
yet.

## How the numbers are computed

- Monthly rate = annual rate ÷ 12; interest and insurance are rounded to
  the cent each month; the last instalment absorbs the remaining cents, so
  the capital owed always ends at exactly 0.
- Monthly instalments only; up to 50 years.
- The effective rate (TAEG) is not computed.
