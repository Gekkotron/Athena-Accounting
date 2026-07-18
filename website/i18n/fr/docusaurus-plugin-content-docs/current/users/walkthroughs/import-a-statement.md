---
title: Importer un relevé bancaire
sidebar_position: 1
---

# Importer un relevé bancaire

Athena accepte les fichiers **OFX**, **QFX**, **CSV** (format français) et **PDF** de relevé bancaire. Ce guide vous accompagne du dépôt du fichier jusqu'à la vérification du solde.

## 1. Ouvrir la page Imports

Depuis la barre latérale, dépliez **Données** puis cliquez sur **Imports**. Vous arrivez sur la zone de dépôt : le bandeau du haut rappelle les formats acceptés (OFX Latin‑1/UTF‑8, CSV FR avec séparateur `;` et décimale virgule, dates `JJ/MM/AAAA`, PDF de relevé bancaire).

![Page Imports](/img/walkthroughs/fr/import-01-imports-page.png)

## 2. Glisser le fichier et choisir le compte

Glissez votre fichier dans la zone **Fichier(s)** — ou cliquez sur **Parcourir**. Sélectionnez le **compte** de destination dans la liste déroulante à droite, puis lancez **Importer**. La première fois qu'un PDF d'une banque est chargé, un assistant s'ouvre : vous désignez à la souris les zones **Date**, **Libellé** et **Montant**. Le modèle est mémorisé — les imports suivants de cette banque sont automatiques.

## 3. Traiter les doublons éventuels

Après l'import, l'onglet **Doublons** liste les transactions candidates : deux lignes très proches en date, montant et libellé. Passez chaque paire en revue et **Fusionner** ou **Ignorer**. Rien n'est écrit sans votre validation.

![Onglet Doublons](/img/walkthroughs/fr/import-02-doublons.png)

## 4. Vérifier le solde de contrôle

Rendez-vous sur **Comptes** dans la barre latérale. Chaque compte affiche son solde calculé par Athena à partir des transactions présentes. Comparez-le au solde de clôture indiqué en bas de votre relevé PDF — s'il diffère, c'est le signe qu'une ligne a été zappée à l'import ou qu'un doublon reste à traiter.

![Vérification du solde sur la page Comptes](/img/walkthroughs/fr/import-03-comptes-solde.png)

### Ancrer un point de contrôle

Une fois le solde vérifié, transformez-le en **point de contrôle**. Cliquez sur ▸ **Points de contrôle** en bas de la carte du compte pour ouvrir le tiroir chronologique, puis saisissez la date du relevé, le solde constaté et une note optionnelle (« Vérifié depuis le relevé papier », par exemple).

Trois raisons de le faire dès maintenant :

- **Garde-fou d'intégrité.** Chaque futur import est comparé silencieusement à tous les points de contrôle passés. Si un solde recalculé s'écarte de la référence d'un centime, Athena affiche l'écart — c'est le seul moyen fiable de détecter une transaction perdue lors d'un import, ou un doublon fusionné à tort des mois plus tard.
- **Ancrage d'historique.** Vos comptes n'ont pas besoin d'être « propres depuis le jour 1 ». Ancrez le solde du jour, importez seulement les derniers mois, et Athena calcule tout ce qui vient après en s'appuyant sur cette ancre.
- **Trace papier.** Chaque point porte une date et une note libre — les entrées les plus récentes s'ouvrent en tête du tiroir, groupées par année.

![Tiroir des points de contrôle sur la carte du compte](/img/walkthroughs/fr/import-04-checkpoints.png)

Sur le **Tableau de bord**, les points de contrôle apparaissent sous forme de losanges le long de la courbe du solde — verts quand le solde calculé correspond, teintés quand un écart est détecté. Passez la souris dessus pour lire l'écart exact entre le solde attendu et le solde calculé à cette date.

![Losange de point de contrôle sur la courbe du solde](/img/walkthroughs/fr/reports-01-dashboard.png)

## Étapes suivantes

Les transactions importées attendent d'être catégorisées. Continuez avec [Catégoriser les transactions](./categorise-transactions.md) pour créer vos premières règles et automatiser le tri.
