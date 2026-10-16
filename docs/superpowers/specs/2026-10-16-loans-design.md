# Loans — design

**Status:** proposed
**Date:** 2026-10-16

## Problem

Athena tracks balances, budgets and savings goals, but has no place for
the loans a household is repaying (mortgage, car, consumer credit). Users
want to know, for each loan: how much capital is still owed today, when it
ends, and what it costs in total (interest + insurance + fees). Real French
loans are rarely a single constant instalment: they have reduced phases
(*paliers*, *lissage*), deferrals during construction (*différé partiel /
total*), rate changes (variable rate, renegotiation) and early repayments
(*remboursement anticipé*). Users also want to try "what if" scenarios —
"what if I repay 20 000 € next year?", "what if I pay 1 400 € instead of
1 216 €?" — and keep some of them as saved simulations.

## Goals

- A `/loans` page listing multiple loans, each with multiple periods and a
  per-period monthly amount.
- The app computes whatever the user doesn't provide: the last period's
  payment from the end date, **or** the end date from the payment.
- Interest rate per loan, overridable per period; 0 % supported.
- Insurance rate per loan, 0 % supported (consumer credit), on the initial
  capital **or** on the remaining capital, chosen per loan.
- Partial deferral, total deferral, rate change per period, early
  repayment (reduce payment or shorten), with optional penalty.
- Total cost of the loan = interest + insurance + fees + penalties.
- "Where am I today" status computed from the schedule and today's date.
- What-if mode on a saved loan (compare, then discard / apply / save as
  simulation) and a blank simulator; saved simulations listed separately.

## Non-goals (v1)

- Linking a loan to an account or matching transactions.
- Counting capital owed as a liability on the Dashboard / net worth.
- MCP tools for loans (the backend engine makes this cheap in v2).
- TAEG / effective annual rate.
- Quarterly or annual instalment frequencies — monthly only.

## Architecture

The calculation engine lives in the **backend** (single source of truth,
MCP-ready later). The frontend never computes schedules except through the
engine.

```
backend/src/domain/loans/engine/   pure TS, no DB, no Node APIs, no deps
backend/src/domain/loans/          (de)serialisation, row ↔ definition
backend/src/http/routes/loans/     index.ts, list.ts, crud.ts, simulate.ts, schemas.ts
frontend/src/pages/Loans/          page, cards, drawer, editor, what-if
frontend/src/api/loans.ts          API client
frontend/src/api/demo/handlers/loans.ts  demo handler
```

**Demo mode** has no backend. The demo handler imports the engine directly
from `backend/src/domain/loans/engine/` (Vite bundles a pure TS file from
outside `frontend/src`; the engine therefore must stay dependency-free and
use only relative imports). If this fights the toolchain, fall back to the
repo's usual demo mirror *plus* a shared fixture file of reference cases
that both copies must pass.

### HTTP API

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/api/loans` | `?asOf=YYYY-MM-DD` (optional) | `{ loans: LoanListItem[] }` — definition fields + `summary` |
| GET | `/api/loans/:id` | `?asOf=` | `{ loan: LoanDefinition, schedule: ScheduleRow[], summary }` |
| POST | `/api/loans` | `LoanInput` | `201 { loan }` |
| PATCH | `/api/loans/:id` | partial `LoanInput` | `{ loan }` |
| DELETE | `/api/loans/:id` | — | `204` |
| POST | `/api/loans/simulate` | `LoanInput` (no id needed), `?asOf=` | `{ schedule, summary, warnings }` |

- All routes are user-scoped; another user's id returns 404.
- POST/PATCH run the engine before writing: engine **errors** → 422 with
  `{ code, message, field? }`; engine **warnings** are returned but do not
  block the save.
- `/simulate` returns 422 on errors too, so the editor can show them inline.
- `asOf` defaults to today (server local date).
- Contract types (`LoanDefinition`, `LoanInput`, `ScheduleRow`,
  `LoanSummary`, `LoanWarning`) go in `shared/api-contracts.ts`.

## Data model

Migration `0048_loans.sql`, Drizzle table `loans` in `backend/src/db/schema.ts`.

| column | type | notes |
|---|---|---|
| `id` | serial PK | |
| `user_id` | integer NOT NULL → users ON DELETE CASCADE | |
| `name` | text NOT NULL | unique per `(user_id, name)` |
| `kind` | text NOT NULL | `mortgage` / `consumer` / `auto` / `other` — label + icon only |
| `is_simulation` | boolean NOT NULL default false | |
| `source_loan_id` | integer → loans ON DELETE SET NULL | real loan a simulation derives from |
| `currency` | varchar(3) NOT NULL default `EUR` | display only, no FX |
| `principal` | numeric(14,2) NOT NULL | > 0 |
| `start_date` | date NOT NULL | first instalment; its day-of-month is the payment day |
| `annual_rate` | numeric(7,4) NOT NULL | nominal annual %, `3.5000` = 3.5 %; 0 allowed |
| `insurance_rate` | numeric(7,4) NOT NULL default 0 | annual %; 0 allowed |
| `insurance_basis` | text NOT NULL default `initial` | `initial` / `remaining` |
| `fees` | numeric(14,2) NOT NULL default 0 | one-off fees (dossier, guarantee, broker) |
| `periods` | jsonb NOT NULL default `[]` | ordered fixed periods |
| `final_period` | jsonb NOT NULL | the solved last period |
| `early_repayments` | jsonb NOT NULL default `[]` | |
| `created_at`, `updated_at` | timestamptz NOT NULL default now() | |

Indexes: unique `(user_id, name)`, index on `user_id`.

JSON shapes (zod-validated on write; amounts and rates are decimal strings,
as elsewhere in the API):

```ts
type FixedPeriod = {
  kind: 'payment' | 'partial_deferral' | 'total_deferral';
  months: number;          // integer ≥ 1
  amount?: string;         // required iff kind === 'payment'; excludes insurance
  rate?: string | null;    // annual % override for this period
};

type FinalPeriod =
  | { solve: 'payment'; endDate: string /* YYYY-MM */; rate?: string | null }
  | { solve: 'end_date'; amount: string; rate?: string | null };

type EarlyRepayment = {
  date: string;            // YYYY-MM — applied after that month's instalment
  amount: string;          // > 0
  effect: 'reduce_payment' | 'shorten';
  penalty?: string;        // IRA, counted in the cost
};
```

Entered monthly amounts **exclude insurance**; insurance is always shown on
its own line and in "total per month incl. insurance".

**Backup:** `domain/backup/dump.ts` and the restore path include `loans`.
Restore inserts all loans with `source_loan_id = NULL`, then patches
`source_loan_id` in a second pass via the old-id → new-id map, so row
order can never break the self-referencing FK.

## Calculation rules (engine)

**Timeline.** Instalment *k* (1-based) is dated `start_date + (k−1)
months`, same day-of-month, clamped to the month's last day (31 → 30/28/29).
Fixed periods run consecutively from instalment 1; the final period
follows. Hard cap: 600 instalments total.

**Money.** All arithmetic in **integer cents**. Monthly rate
`r = rate / 100 / 12` where `rate` is the period's override or the loan's
`annual_rate`. Every per-month amount is rounded to the cent
(round half away from zero).

**Each month**, with `balance` = capital owed at the start of the month:

| kind | interest | capital repaid | instalment (excl. insurance) |
|---|---|---|---|
| `payment` | `round(balance·r)` | `amount − interest` | `amount` |
| `partial_deferral` | `round(balance·r)` | 0 | `interest` |
| `total_deferral` | `round(balance·r)` — **capitalised** | `−interest` | 0 |
| final period | `round(balance·r)` | `P − interest` | `P` (solved) |

**Insurance**, charged every month including deferral months:
- `initial`: `round(principal · insurance_rate / 100 / 12)`, constant.
- `remaining`: `round(balance · insurance_rate / 100 / 12)`, `balance` at
  the start of the month.

**Solving the final period** from `B` = balance at its start:
- `solve: 'payment'`: `n` = months from the final period's first
  instalment to `endDate` inclusive. `P = round(B·r / (1 − (1+r)^−n))`;
  if `r = 0`, `P = round(B / n)`.
- `solve: 'end_date'`: `P = amount`; step month by month until the
  balance reaches 0.
- **The last instalment absorbs rounding**: it pays exactly the remaining
  balance + its interest, so the balance ends at exactly 0.

**Early repayments**, processed in date order, applied right after that
month's instalment:
- `balance −= min(amount, balance)`; if this reaches 0 the loan ends at
  that date.
- Fixed periods keep their contractual amounts. The effect applies to the
  final period (both solve modes):
  - `reduce_payment` — keep the current end date (for `solve: 'end_date'`,
    the end date computed just before this repayment), recompute `P` from
    the new balance over the remaining months.
  - `shorten` — keep the current `P`, the end date moves earlier.
- If the repayment falls inside a fixed period, the effect is applied
  when the final period starts (for `reduce_payment`, `P` is solved from
  the then-lower `B` against the original end date; for `shorten`, `P` is
  the value it would have had without the repayment).
- `penalty` is added to total cost.

**Errors** (engine returns `{ ok: false, errors }`; API → 422):
- `principal ≤ 0`; any rate outside `[0, 100]`; `months < 1`;
  `payment` period without `amount`.
- `solve: 'payment'` with `endDate` not after the last fixed period.
- `solve: 'end_date'` with `amount ≤` first-month interest of the final
  period ("this payment never repays the loan").
- More than 600 instalments.
- Early repayment dated before `start_date` or after the loan's end.

**Warnings** (returned, non-blocking):
- `repaid_during_fixed_period` — balance hit 0 inside a fixed period;
  later periods ignored.
- `negative_amortization` — a fixed `payment` amount is below the interest
  for at least one month (capital grows).

**Output.**

```ts
type ScheduleRow = {
  index: number; date: string /* YYYY-MM-DD */; periodIndex: number; // -1 = final
  kind: 'payment' | 'partial_deferral' | 'total_deferral' | 'final';
  rate: string; payment: string; interest: string; capital: string;
  insurance: string; earlyRepayment: string | null; balance: string; // after this month
};

type LoanSummary = {
  currentPayment: string; currentPaymentWithInsurance: string; // instalment in force at asOf (first one if not started)
  solvedPayment: string | null; // P of the final period (initial value)
  endDate: string; durationMonths: number;
  totals: { interest: string; insurance: string; fees: string; penalties: string;
            cost: string; repaid: string }; // cost = interest+insurance+fees+penalties
  today: { asOf: string; capitalOwed: string; repaidPct: number;
           interestPaid: string; monthsLeft: number;
           nextInstalment: { date: string; amount: string } | null;
           status: 'not_started' | 'active' | 'repaid' };
};
```

## Frontend

**Navigation.** `nav-config.ts`: `{ to: '/loans', labelKey:
'nav.items.loans', icon: 'loans' }` after Goals in the "daily" section; new
nav icon. Route `/loans` in `App.tsx`. Two tabs: **My loans**
(`is_simulation = false`) and **Simulations**.

**Loan card.** Name, kind icon, "Simulation" badge; capital owed today +
progress bar (% repaid); current monthly payment incl. insurance and next
instalment date; end date; total cost. Repaid loans get a "Repaid" badge
and sort last.

**Detail drawer** (wide, Goals-style):
1. Summary strip — capital owed, % repaid, interest paid vs total, months
   left, end date, total cost split interest / insurance / fees / penalties.
2. Capital-owed chart — hand-rolled SVG area (no new chart dependency,
   same approach as `BalanceChart`), markers for today, period boundaries,
   early repayments.
3. Periods timeline — one row per period (dates, kind, amount, rate); the
   final period labelled "computed".
4. Schedule table — grouped by year (collapsible, yearly subtotals),
   scrolled to the current month.
5. Actions — Edit, What-if, Duplicate as simulation, Delete.

**Editor** (create / edit / blank simulator):
- *Basics*: name, kind, principal, start date, rate, insurance rate +
  basis, fees.
- *Timeline*: fixed periods (add / remove / reorder; kind, months, amount,
  rate); final-period toggle "I know the end date → compute payment" /
  "I know the monthly amount → compute end date"; early repayments (date,
  amount, effect, penalty).
- Live preview: debounced (~250 ms) `POST /api/loans/simulate`; the solved
  value is shown inline in the final-period row ("→ 1 216,40 €/mois" or
  "→ fin mai 2043"); errors and warnings inline at the offending field.
- A constant loan is just Basics + end date.
- **Decimal inputs**: text inputs with `inputMode="decimal"` + the existing
  `parseDecimal` helper; never `<input type="number">`.

**"I'm changing my payment from date X"** (detail-view shortcut, pure
helper `splitAtDate(definition, schedule, X, newAmount)`): history up to
X−1 becomes a fixed `payment` period at the instalment actually in force
(splitting existing periods if needed), and a new final period starts at X
with `{ solve: 'end_date', amount: newAmount }`. Result is previewed via
`/simulate` before saving.

**What-if mode** on a saved loan: side-by-side **Current vs What-if**
(end date, monthly payment, total cost, deltas such as "−7 500 €, 2 ans 8
mois plus tôt"); quick levers (add early repayment, change payment from a
date, change rate) plus the full timeline editor. Exits: **Discard**,
**Apply to loan** (PATCH), **Save as simulation** (POST with
`is_simulation = true`, `source_loan_id` set). A simulation with a
`source_loan_id` opens with the same comparison against its source.

**i18n.** New `loans.json` in `en` and `fr`; nav keys in `layout.json`.

**Lint.** Every file < 300 lines (CI error): drawer, schedule table,
chart, editor sections and what-if panel are separate components.

**Demo.** Seed: one mortgage with a 12-month partial deferral then an end
date, one 0 % / 0 % insurance consumer loan, one simulation derived from
the mortgage with an early repayment.

## Testing

**Engine** (`backend/tests/loans-engine*.test.ts`, pure, always run):
- Reference: 200 000 € / 3.5 % / 240 months → 1 159,92 €; 24 × 800 € then
  solved ≈ 1 216 € — verified against an independent closed-form
  calculation in the test.
- Invariants on every case: final balance exactly 0; Σ capital +
  Σ early repayments = principal + Σ capitalised interest;
  cost = interest + insurance + fees + penalties.
- 0 % rate, 0 % insurance, `initial` vs `remaining` insurance, partial and
  total deferral, per-period rate override, both solve modes and their
  round-trip (solve payment → feed it back as amount → same end date),
  early repayment with each effect, inside a fixed period, and full payoff.
- Edges: day 31 clamping, 1-month loan, 600 cap, every error and warning.
- `asOf` before start, mid-loan, after end.

**Routes** (`backend/tests/loans-route.test.ts`, existing route-test
pattern; DB-backed parts behind `RUN_DB_TESTS`): zod validation of the JSON
shapes, 422 mapping, `/simulate` without id, per-user scoping (404),
`source_loan_id` nulled on source delete, backup dump/restore round-trip.

**Frontend** (co-located `__tests__/`): editor decimal parsing and
final-period toggle, `splitAtDate`, what-if delta formatting, card and
drawer render from a fixture, demo handler summary equals the engine's.

**E2E**: one Playwright spec on the demo build — create a loan, see the
computed payment, add a what-if early repayment, see the savings.

**Before pushing**: `cd backend && npx vitest run`, `cd frontend && npx
vitest run`, ESLint (via `rtk proxy`), migration applied on PGlite.
