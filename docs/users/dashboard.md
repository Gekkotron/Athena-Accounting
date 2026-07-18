---
title: Dashboard
sidebar_position: 5
---

# Dashboard

The Dashboard is Athena's single-page read on your money. It answers three questions, top to bottom: "How much do I have available?", "How is it evolving?", and "Where is the money going?". Every card responds to the two pickers in the page header — a **Range picker** (period) and an **Account scope picker** — so you can narrow the whole view to a joint account, a quarter, or a single month without leaving the page.

## Net Balance, monthly averages, and Insights

At the top sits the **Net Balance** card: the sum of your current accounts. A second line right below breaks out **invested** funds (savings accounts, brokerage, and anything you flagged as invested on its account card) so you don't confuse long-term reserves with day-to-day cash.

To the right, three **Monthly averages** cards summarise the last five rolling months — spending, income, and savings. Five months is enough to smooth over one-off dips (a big yearly invoice, an unusual bonus) without averaging away trends you actually want to see.

Below them, the **Insights** panel highlights the standout events of the current month: sharpest rise or fall in a category versus the previous month, budgets on track to overrun, income below spending. Each insight is a clickable sentence that jumps to the matching transactions.

![Dashboard — Net Balance, monthly averages, and Insights](/img/walkthroughs/en/reports-01-dashboard.png)

## Trend chart with checkpoint diamonds

Scroll to the **Trend** card. It plots the daily balance over the selected range, one line per account when several accounts are visible, or a single summed line when the account scope is set to "all". Gaps between imports are drawn as dotted segments so you can tell "flat balance" from "no data for that stretch".

**Checkpoints** you anchored from an account card show up as diamonds along the curve — green when the computed balance matches the anchored value on that date, tinted when a drift is detected. Hover any diamond to see the exact delta between the expected and computed balance; a persistent tint is your cue that something is missing (an un-imported transaction, an unresolved duplicate).

![Trend chart with checkpoint diamonds](/img/walkthroughs/en/reports-04-balance-curve.png)

## Category donut

Below the Trend sits **Breakdown by category** — a donut of outflows over the selected range, with the ranked list on the right. Click a slice to filter every card on the page (Trend, Sankey, Insights) to that category; click it again — or the empty centre of the donut — to clear the filter. This is how you drill from "expenses look higher this month" down to "it was groceries", without leaving the Dashboard.

![Breakdown by category — donut](/img/walkthroughs/en/reports-02-dashboard-mid.png)

## Cash-flow Sankey

At the bottom, the **Cash-flow Sankey** traces the path from your income sources into your spending categories and your savings, over the selected range. Bands are proportional to amounts, so a fat band from *Salary* into *Rent* is instantly readable. This is the read that answers "where is the money going?" at a glance — useful for the monthly retrospective, and for spotting categories that quietly grew.

![Cash-flow Sankey diagram](/img/walkthroughs/en/reports-03-dashboard-bottom.png)

## How the Range and Account pickers interact

Both pickers live in the page header and apply to every card on the Dashboard at once — you never have to re-select a range per card. Changing the **Range** (last 30 days, this month, last month, this year, custom) reshapes the Trend, the donut totals, the Sankey bands, and the Insights population. Changing the **Account scope** (all accounts, one account, or a custom subset) filters the Net Balance, the Trend lines, and the transactions feeding the donut and Sankey. Combined with the donut's slice filter, that gives you three orthogonal filters — period, account, category — you can layer without opening a form.

## Next steps

- [Categorization](categorization.md) — get the donut and Sankey to tell the story you expect by cleaning up how transactions are labelled.
- [Accounts & data](accounts-and-data.md) — flag invested accounts and anchor checkpoints so the Trend picks them up.
- [View reports walkthrough](walkthroughs/view-reports.md) — a shorter, screenshot-first tour of the same page.

← [Back to user docs](README.md)
