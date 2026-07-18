---
title: Glossary
sidebar_position: 4
---

# Glossary

Athena's UI is in French. This page maps the French labels the interface uses
to their English equivalents so English-only readers of the docs can follow
along in the app.

## Navigation and tabs

| French label       | English equivalent              | Where you see it / what it means                                            |
| ------------------ | ------------------------------- | --------------------------------------------------------------------------- |
| Dashboard          | Dashboard                       | Landing page — balances, trend, category breakdown, insights, Sankey.       |
| Transactions       | Transactions                    | The full ledger, filterable by account, category, date range.               |
| Comptes            | Accounts                        | List of bank accounts; also the top-level nav group holding accounts pages. |
| Motifs de fichier  | File patterns                   | Regexes that map an imported file's name to a target account.               |
| Règles             | Rules                           | Auto-categorization rules; also the nav group holding Tri / Règles / Catégories. |
| Tri                | Sort (triage)                   | Bulk-categorization queue — uncategorized transactions grouped by vendor.   |
| Catégories         | Categories                      | The category tree used to classify transactions.                            |
| Budgets            | Budgets                         | Nav group holding Plafonds and Enveloppes.                                  |
| Plafonds           | Caps (monthly budgets)          | Per-category monthly spending caps.                                         |
| Enveloppes         | Envelopes                       | Fixed pots set aside from Disponible; see "Enveloppe" below.                |
| Données            | Data                            | Nav group holding Imports, Doublons, Modèles PDF, Sauvegarde.               |
| Imports            | Imports                         | History of statement imports and the entry point to import a new file.     |
| Doublons           | Duplicates                      | Suspected duplicate transactions awaiting merge or dismissal.               |
| Modèles PDF        | PDF templates                   | Saved column/row templates that let Athena parse a bank's PDF statements.   |
| Sauvegarde         | Backup                          | Export the full data envelope to a JSON file and restore from one.          |
| Réglages           | Settings                        | User preferences — default range, chart gap threshold, MCP token, etc.     |

## Money terms

| French term         | English equivalent              | Meaning in Athena                                                          |
| ------------------- | ------------------------------- | -------------------------------------------------------------------------- |
| Solde               | Balance                         | Signed sum of transactions on an account.                                  |
| Disponible          | Available                       | Cash you can spend today — total balance minus Bloqué and active Enveloppes. |
| Bloqué              | Locked / reserved               | Amount you have chosen to fence off from Disponible (rent-in-transit, tax). |
| Ventilation         | Split / allocation              | Breaking one transaction across several categories.                        |
| Point de contrôle   | Checkpoint                      | Anchor tying a real bank balance on a given date to Athena's computed one. |
| Enveloppe           | Envelope                        | A fixed pot reserved from Disponible for a recurring goal (holiday, gifts). |
| Plafond             | Cap                             | A monthly ceiling on a category's spend; drives the Budgets alerts.        |
| Transfert           | Transfer                        | A transaction moving money between two of your own accounts.               |
| Investi             | Invested                        | Marks an account whose balance is treated as savings, not spend.           |

## Import terms

| French term         | English equivalent              | Meaning in Athena                                                           |
| ------------------- | ------------------------------- | --------------------------------------------------------------------------- |
| Relevé              | Statement                       | A bank statement file (PDF, CSV, OFX) uploaded through Imports.             |
| Modèle              | Template                        | A saved PDF parsing recipe — page layout + column boundaries.               |
| Ligne               | Row / line                      | A single line on the statement — becomes one transaction on import.         |
| Colonne             | Column                          | A column in the PDF/CSV grid (date, label, debit, credit, balance).         |
| Doublon             | Duplicate                       | A transaction Athena flags as likely already imported.                      |
| Motif de fichier    | File pattern                    | Regex on the file name that routes an import to a specific account.         |
| Import              | Import                          | The act of loading a Relevé, or the audit row that records it.              |

## Chart and dashboard terms

| French term         | English equivalent              | Meaning in Athena                                                           |
| ------------------- | ------------------------------- | --------------------------------------------------------------------------- |
| Évolution           | Trend / balance-over-time chart | Line chart of running balance across the selected range.                    |
| Répartition         | Breakdown / donut               | Donut chart splitting spend across categories.                              |
| Sankey des flux     | Cash-flow Sankey                | Flow diagram from income sources through categories to Disponible.          |
| Insights            | Insights                        | Panel of auto-generated observations (largest drop, unusual vendor, etc.).  |
| Plage               | Range (date-range picker)       | The selected date window driving every card on the Dashboard.               |
| Portée              | Scope (account-scope picker)    | Which accounts the Dashboard cards aggregate over.                          |
| Solde net           | Net balance                     | Sum of all in-scope accounts' balances at the end of the selected Plage.    |
| Moyenne mensuelle   | Monthly average                 | Average monthly inflow / outflow across the selected Plage.                 |

← [Back to reference index](README.md)
