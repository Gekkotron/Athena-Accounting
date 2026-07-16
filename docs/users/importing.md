# Importing

Importing is the core of Athena. This page covers every format Athena
accepts, the PDF template wizard (the piece most people find magical),
multi-account statement handling, deduplication, and what to do when
something doesn't import cleanly.

## Supported formats

| Format | How Athena reads it |
|--------|---------------------|
| **OFX / QFX** | Bank-standard exchange format. Athena parses SGML-style OFX in Latin-1 (Windows-1252) or UTF-8 — encoding is detected from the OFX header. Import is one drop-and-done step. |
| **CSV (French banks)** | Auto-detected separator (`;` or `,`), French date format `JJ/MM/AAAA`, French decimal comma. Header names are matched accent- and case-insensitively. Athena expects a date column, a label column, and either a `Montant` column or a `Débit` + `Crédit` pair. |
| **PDF** | Bank statements as PDF. First statement from a new bank walks through the template wizard (below). Later statements in the same format import automatically. |

You can drop a **single file**, **several files at once**, or **a
whole folder**. Files are processed sequentially and each one gets its
own one-line summary: inserted / skipped / needs-template / errored.

## Before you import

Create the destination account first (*Comptes → Ajouter*). The
opening balance and opening date are mandatory — every reported balance
is computed as `opening_balance + SUM(amount WHERE date >= opening_date)`.

Optionally, add **filename patterns** on the same account tab. Athena
matches the pattern against the file you drop and picks the target
account automatically, so you don't have to select one every time.

## OFX and CSV

Both are one-step. Drop the file on the Imports page; Athena parses
it, runs categorization rules, and inserts new transactions. The
response reports inserted vs deduped counts.

**Encoding note (OFX):** French banks typically emit OFX in
Windows-1252. Athena detects the encoding from the OFX header and
re-encodes to UTF-8 for the database. If your OFX file has garbled
accents in the label after import, that's a bug — please open an issue
with a redacted sample.

## The PDF template wizard

PDFs don't have a machine-readable transaction format the way OFX
does. Athena solves this by asking you to **paint the transaction
zones once per bank format**, then reusing that template for every
future statement in the same format.

### First-time flow

1. Drop a PDF from a new bank on the Imports page.
2. Athena opens the template wizard: your PDF on the left, three
   tools on the right — **Amount**, **Date**, **Label**.
3. Draw a rectangle over one occurrence of each of the three fields.
   You're teaching Athena "amounts live in this column, dates in this
   column, labels in this column."
4. Athena replays the template on the whole PDF and shows you the
   transactions it found. If they look right, save the template and
   import. If not, adjust the rectangles.

The template is stored per bank / statement format. The next statement
in the same format skips the wizard entirely.

### Multi-account PDF statements

Some banks emit a single PDF that contains multiple accounts (joint
statements, family bundles). Athena handles this with **content-based
page filtering**:

- The template stores an "account anchor" — a text pattern that
  appears on pages belonging to your account.
- On import, Athena keeps only the pages that match the anchor and
  filters out the rest.
- If pages are ambiguous, a **"mine / other account"** selector lets
  you assign them manually.

### Auto-recovery: when a template stops matching

Banks occasionally reword statement headers. If a saved template
stops finding transactions on a fresh statement, Athena
**auto-recovers** by re-training the template against the new
statement — so you don't lose the wizard investment when your bank
ships a minor layout change.

## Deduplication

Every import checks new transactions against what's already in the
database. Duplicates are detected on a content signature (date,
amount, account, normalised label) and silently skipped.

The per-file summary shows a **"read but deduped"** count so you can
tell "the file had nothing new" from "the file was empty or broken."

Every import also writes an **audit row** — file name, hash, and
count of inserted / skipped / errored — so re-importing the same file
twice is safe and traceable. A "0 inserted" outcome on a re-import
means the dedup keys matched, not that something went wrong.

## Internal transfers

If you have two accounts and move money between them, both legs will
show up in their respective imports as ordinary expenses / incomes.
Athena's transfer detector links them via a shared `transfer_group_id`
and excludes them from income/expense aggregates. Configure the
keyword pairs in **Règles** (the transfer-rules UI is minimal; the
API is at `/api/transfer-rules`). Once matched, the importer looks for
the mirror leg in the counterpart account within ±7 days.

## Troubleshooting

**"The template wizard says it can't find transactions."**
Your rectangles are probably too tight. Amounts and dates need a
little horizontal padding; labels usually need a wider box.

**"pdfjs fragmented the text weirdly."**
Some PDFs render text in overlapping fragments. Athena's parser
handles the common cases; if you hit an edge case, please open an
issue with a redacted sample statement.

**"My template used to work and stopped."**
Re-run the import — the auto-recovery re-train usually catches this.
If it doesn't, delete the template (*Réglages → Modèles*) and paint a
new one.

**"A transaction I want was deduped."**
Deduplication uses date + amount + account + normalised label. Two
legitimately different transactions with the same values on the same
day (rare but possible — think "two identical coffee purchases") can
collide. Add the second one manually.

**"0 inserted on a re-import — did it fail?"**
No. That's the dedup working. Compare the "read" count to the
"deduped" count in the summary: if they match, everything in the file
was already in the database.

## Where to go next

- **[Categorization](categorization.md)** — once transactions are in,
  categorize them.
- **[Accounts & data](accounts-and-data.md)** — balance checkpoints
  cross-check your imports against your bank statements.
- **[Troubleshooting](troubleshooting.md)** — more failure modes.

← [Back to user docs](README.md)
