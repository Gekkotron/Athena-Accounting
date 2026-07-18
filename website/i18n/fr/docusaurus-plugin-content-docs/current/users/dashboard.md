---
title: Tableau de bord
sidebar_position: 5
---

# Tableau de bord

Le Tableau de bord est la lecture d'un coup d'œil d'Athena sur votre argent. Il répond, de haut en bas, à trois questions : « Combien ai-je de disponible ? », « Comment cela évolue-t-il ? » et « Où part l'argent ? ». Chaque carte réagit aux deux sélecteurs du bandeau de la page — un **sélecteur de période** et un **sélecteur de comptes** — pour restreindre l'ensemble de la vue à un compte joint, un trimestre ou un mois donné sans quitter la page.

## Solde net, moyennes mensuelles et Insights

Tout en haut, la carte **Solde net** : la somme de vos comptes courants. Une seconde ligne juste en dessous isole les fonds **investis** (livrets, comptes-titres et tout compte marqué comme investi depuis sa carte) pour ne pas confondre l'épargne long terme et la trésorerie du quotidien.

À droite, trois cartes de **moyennes mensuelles** résument les cinq derniers mois glissants — dépenses, revenus, épargne. Cinq mois suffisent à lisser les à-coups ponctuels (une grosse facture annuelle, une prime inhabituelle) sans effacer les tendances que vous cherchez à voir.

En dessous, le panneau **Insights** met en avant les faits marquants du mois en cours : plus forte hausse ou baisse dans une catégorie par rapport au mois précédent, budgets en passe d'être dépassés, revenus inférieurs aux dépenses. Chaque insight est une phrase cliquable qui ouvre la liste des transactions correspondantes.

![Tableau de bord — Solde net, moyennes mensuelles et Insights](/img/walkthroughs/en/reports-01-dashboard.png)

## Évolution avec losanges de points de contrôle

Faites défiler jusqu'à la carte **Évolution**. Elle trace le solde quotidien sur la période choisie, une ligne par compte quand plusieurs comptes sont visibles, ou une seule ligne agrégée quand le sélecteur de comptes est réglé sur « tous ». Les trous entre deux imports sont dessinés en pointillés, pour distinguer un « solde stable » d'un « pas de données sur cet intervalle ».

Les **points de contrôle** que vous avez ancrés depuis une carte de compte apparaissent en losanges le long de la courbe — verts quand le solde calculé correspond à la valeur ancrée à cette date, teintés en cas de dérive. Survolez un losange pour lire l'écart exact entre le solde attendu et le solde calculé ; une teinte persistante indique qu'il manque quelque chose (transaction non importée, doublon non résolu).

![Évolution avec losanges de points de contrôle](/img/walkthroughs/en/reports-04-balance-curve.png)

## Répartition par catégorie

Sous l'Évolution se trouve **Répartition par catégorie** — un donut des sorties sur la période choisie, avec la liste triée à droite. Cliquez sur une part pour filtrer toutes les cartes de la page (Évolution, Sankey, Insights) sur cette catégorie ; recliquez dessus — ou sur le centre vide du donut — pour lever le filtre. C'est ainsi qu'on passe de « les dépenses ont augmenté ce mois-ci » à « c'est la catégorie Courses », sans quitter le Tableau de bord.

![Répartition par catégorie — donut](/img/walkthroughs/en/reports-02-dashboard-mid.png)

## Sankey des flux

Tout en bas, le **Sankey des flux** trace, sur la période choisie, le chemin de vos sources de revenus vers vos catégories de dépenses et votre épargne. La largeur des bandes est proportionnelle aux montants ; un ruban épais entre *Salaire* et *Loyer* saute immédiatement aux yeux. C'est la lecture qui répond à « où part l'argent ? » d'un coup d'œil — utile pour la rétrospective mensuelle et pour repérer les catégories qui gonflent en silence.

![Sankey des flux](/img/walkthroughs/en/reports-03-dashboard-bottom.png)

## Comment les sélecteurs de période et de comptes interagissent

Les deux sélecteurs vivent dans le bandeau de la page et s'appliquent à toutes les cartes du Tableau de bord en même temps — vous n'avez jamais à re-choisir une période carte par carte. Changer la **période** (30 derniers jours, ce mois, mois dernier, cette année, personnalisée) redessine l'Évolution, recalcule les totaux du donut, réajuste les bandes du Sankey et met à jour la population des Insights. Changer le **périmètre de comptes** (tous les comptes, un compte, ou un sous-ensemble) filtre le Solde net, les lignes de l'Évolution et les transactions qui alimentent le donut et le Sankey. Combiné au filtre de part du donut, cela donne trois filtres orthogonaux — période, compte, catégorie — que l'on empile sans ouvrir de formulaire.

## Aller plus loin

- [Catégorisation](categorization.md) — pour que le donut et le Sankey racontent l'histoire attendue, en nettoyant l'étiquetage des transactions.
- [Comptes et données](accounts-and-data.md) — pour marquer les comptes investis et ancrer des points de contrôle que l'Évolution suivra.
- [Guide « Voir les rapports »](walkthroughs/view-reports.md) — une visite plus courte, orientée captures d'écran, de la même page.

← [Retour aux docs utilisateur](README.md)
