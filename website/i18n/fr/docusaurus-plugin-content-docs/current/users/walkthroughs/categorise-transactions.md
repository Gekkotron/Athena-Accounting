---
title: Catégoriser les transactions
sidebar_position: 2
---

# Catégoriser les transactions

Une transaction bien catégorisée alimente le tableau de bord, les budgets et les rapports. Athena propose trois voies : édition unitaire, tri assisté par lots, et règles automatiques qui prennent le relais pour la suite.

## 1. Éditer une catégorie en ligne

Ouvrez **Transactions** dans la barre latérale. Chaque ligne expose un sélecteur **Catégorie** modifiable directement — pas de modale, pas d'aller-retour. Les filtres du haut (compte, période, recherche) permettent d'isoler un lot avant de basculer une série de lignes.

![Page Transactions avec les catégories éditables en ligne](/img/walkthroughs/fr/categorise-01-transactions.png)

## 2. Trier par lots depuis l'atelier « Tri »

Pour un premier passage massif sur un import fraîchement chargé, ouvrez **Règles → Tri**. L'atelier vous présente les transactions non catégorisées regroupées par motif de libellé — assignez la catégorie une fois, tout le lot suit. À chaque assignation, Athena vous propose de **transformer le lot en règle** pour que les prochains libellés identiques soient triés tout seuls.

![Atelier de tri par motif](/img/walkthroughs/fr/categorise-02-tri.png)

## 3. Créer une règle à partir d'une transaction

Sur une transaction individuelle, le bouton **Créer une règle** ouvre un formulaire pré-rempli avec le motif détecté (contient, commence par, expression régulière). Réglez la catégorie cible, la portée (comptes concernés) et validez — la règle s'exécute rétroactivement sur l'historique et automatiquement sur les prochains imports.

## 4. Gérer et prioriser les règles

L'onglet **Règles → Liste** affiche toutes vos règles, avec leur ordre d'évaluation. Les règles de **virement interne** (entre deux de vos comptes) y sont marquées : elles neutralisent la transaction dans les rapports de dépenses. Réordonnez par glisser-déposer si deux règles se chevauchent.

![Liste des règles avec les virements internes distingués](/img/walkthroughs/fr/categorise-03-regles-liste.png)

## Étapes suivantes

Une fois vos catégories propres, passez à [Définir un budget](./set-a-budget.md) pour poser un plafond mensuel sur chacune d'elles.
