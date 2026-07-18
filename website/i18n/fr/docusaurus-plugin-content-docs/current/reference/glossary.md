---
title: Glossaire
sidebar_position: 4
---

# Glossaire

L'interface d'Athena est en français, mais une partie de la documentation, du
code et des messages d'erreur reste en anglais. Cette page fait la
correspondance dans les deux sens pour éviter les ambiguïtés — lisez la
première colonne (français) quand vous partez de l'appli, la deuxième
(anglais) quand vous partez d'un ticket, d'un log ou d'un fichier de code.

## Navigation et onglets

| Libellé français   | Terme anglais / code            | Ce à quoi ça correspond                                                     |
| ------------------ | ------------------------------- | --------------------------------------------------------------------------- |
| Dashboard          | Dashboard                       | Page d'accueil — soldes, courbe, répartition, insights, Sankey.             |
| Transactions       | Transactions                    | Le grand livre, filtrable par compte, catégorie, période.                   |
| Comptes            | Accounts                        | Liste des comptes bancaires ; aussi le groupe de navigation associé.        |
| Motifs de fichier  | File patterns                   | Regex qui associe un nom de fichier importé à un compte cible.              |
| Règles             | Rules                           | Règles de catégorisation automatique ; aussi le groupe Tri / Règles / Catégories. |
| Tri                | Sort (triage)                   | File de catégorisation en masse — transactions non catégorisées par vendeur. |
| Catégories         | Categories                      | L'arbre de catégories utilisé pour classer les transactions.                |
| Budgets            | Budgets                         | Groupe de navigation contenant Plafonds et Enveloppes.                      |
| Plafonds           | Caps (monthly budgets)          | Plafonds mensuels de dépense par catégorie.                                 |
| Enveloppes         | Envelopes                       | Sommes mises de côté depuis le Disponible ; voir « Enveloppe » ci-dessous.  |
| Données            | Data                            | Groupe contenant Imports, Doublons, Modèles PDF, Sauvegarde.                |
| Imports            | Imports                         | Historique des imports de relevés et point d'entrée pour en lancer un.      |
| Doublons           | Duplicates                      | Doublons présumés en attente de fusion ou de rejet.                         |
| Modèles PDF        | PDF templates                   | Modèles enregistrés qui permettent à Athena de parser un relevé PDF.        |
| Sauvegarde         | Backup                          | Export complet de la base en JSON et restauration depuis un tel export.     |
| Réglages           | Settings                        | Préférences utilisateur — plage par défaut, seuil de rupture, jeton MCP, etc. |

## Termes financiers

| Terme français      | Terme anglais / code            | Sens dans Athena                                                            |
| ------------------- | ------------------------------- | --------------------------------------------------------------------------- |
| Solde               | Balance                         | Somme signée des transactions sur un compte.                                |
| Disponible          | Available                       | Ce que vous pouvez dépenser aujourd'hui — solde total moins Bloqué et Enveloppes actives. |
| Bloqué              | Locked / reserved               | Montant volontairement mis de côté hors du Disponible (loyer en transit, impôt). |
| Ventilation         | Split / allocation              | Répartir une même transaction sur plusieurs catégories.                     |
| Point de contrôle   | Checkpoint                      | Ancre qui relie un solde bancaire réel à une date au solde calculé par Athena. |
| Enveloppe           | Envelope                        | Pot fixe réservé sur le Disponible pour un objectif récurrent (vacances, cadeaux). |
| Plafond             | Cap                             | Plafond mensuel sur une catégorie ; alimente les alertes Budgets.           |
| Transfert           | Transfer                        | Transaction qui déplace de l'argent entre deux de vos comptes.              |
| Investi             | Invested                        | Marque un compte dont le solde est traité comme épargne, pas comme dépense. |

## Termes d'import

| Terme français      | Terme anglais / code            | Sens dans Athena                                                            |
| ------------------- | ------------------------------- | --------------------------------------------------------------------------- |
| Relevé              | Statement                       | Fichier de relevé bancaire (PDF, CSV, OFX) envoyé via Imports.              |
| Modèle              | Template                        | Recette d'extraction PDF — mise en page + limites de colonnes.              |
| Ligne               | Row / line                      | Une ligne du relevé — devient une transaction à l'import.                   |
| Colonne             | Column                          | Une colonne du tableau PDF/CSV (date, libellé, débit, crédit, solde).       |
| Doublon             | Duplicate                       | Transaction qu'Athena signale comme probablement déjà importée.             |
| Motif de fichier    | File pattern                    | Regex sur le nom du fichier qui aiguille un import vers un compte donné.    |
| Import              | Import                          | L'action de charger un Relevé, ou la ligne d'audit qui en garde trace.      |

## Termes des graphiques et du Dashboard

| Terme français      | Terme anglais / code            | Sens dans Athena                                                            |
| ------------------- | ------------------------------- | --------------------------------------------------------------------------- |
| Évolution           | Trend / balance-over-time chart | Courbe du solde cumulé sur la plage sélectionnée.                           |
| Répartition         | Breakdown / donut               | Camembert répartissant les dépenses par catégorie.                          |
| Sankey des flux     | Cash-flow Sankey                | Diagramme de flux des revenus vers les catégories puis vers le Disponible.  |
| Insights            | Insights                        | Panneau d'observations générées automatiquement (plus grosse baisse, vendeur inhabituel, etc.). |
| Plage               | Range (date-range picker)       | Fenêtre temporelle qui pilote toutes les cartes du Dashboard.               |
| Portée              | Scope (account-scope picker)    | Ensemble de comptes sur lesquels les cartes du Dashboard agrègent.          |
| Solde net           | Net balance                     | Somme des soldes des comptes de la Portée à la fin de la Plage.             |
| Moyenne mensuelle   | Monthly average                 | Moyenne mensuelle des entrées / sorties sur la Plage.                       |

← [Retour à l'index de la référence](README.md)
