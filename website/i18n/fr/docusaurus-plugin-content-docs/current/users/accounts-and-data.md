---
title: Comptes et données
sidebar_position: 6
---

# Comptes et données

Tout ce qui vit en dehors des transactions individuelles : la page
**Comptes**, où l'on façonne les comptes qui sous-tendent chaque
solde, et l'onglet **Données**, qui regroupe les imports, les
doublons, les modèles PDF et les sauvegardes.

## Créer un compte

*Comptes → Nouveau compte*. Un compte requiert cinq informations :

| Champ | Rôle |
|-------|------|
| **Nom** | Texte libre — affiché sur les cartes, dans les listes de transactions et dans le sélecteur de compte. |
| **Type** | `checking`, `savings`, `investment`, `credit` ou `other`. Le type influe sur l'affichage et sur quelques agrégats, mais pas sur le calcul du solde. |
| **Devise** | Code ISO 4217 (EUR, USD, GBP…). Affiché en badge sur chaque carte. |
| **Solde d'ouverture** | Solde à la date d'ouverture. Chaque solde reporté est calculé comme `solde_ouverture + SOMME(montant WHERE date >= date_ouverture)` — ce chiffre est structurel, à saisir avec soin dès le premier jour. |
| **Date d'ouverture** | Date à laquelle le solde d'ouverture est mesuré. Généralement la veille de la première transaction que vous prévoyez d'importer. |

Une **période de blocage** facultative (en années) marque le solde
d'ouverture et les transactions non taguées comme argent bloqué —
voir *« Argent bloqué »* plus bas.

## Modifier un compte

Chaque carte de la page *Comptes* comporte un petit **crayon** en
haut à droite. Il ouvre un éditeur en ligne avec les mêmes champs
que le formulaire de création. Modifier le solde d'ouverture ou la
date d'ouverture recalcule tous les soldes courants du compte — la
courbe du solde, l'évolution du tableau de bord et les points de
contrôle sont tous mis à jour.

L'éditeur en ligne héberge aussi le bouton **Supprimer**. Le serveur
refuse la suppression si le compte porte des transactions —
déplacez-les ou supprimez-les d'abord, ou utilisez la fusion
ci-dessous.

## Devise

Chaque compte est mono-devise. Athena ne convertit pas les devises —
les cartes, graphiques et totaux s'affichent dans la devise propre
au compte, et le tableau de bord regroupe les totaux par devise
lorsque plusieurs sont présentes. Si vous détenez le même compte
physique en deux devises, modélisez-le comme deux comptes Athena.

## Marquer un compte comme investi

Choisir **type = investment** produit deux effets :

- La carte affiche un tag *« investi »* sous le montant, pour que
  les soldes d'investissement se lisent différemment de la
  trésorerie courante.
- Le tableau de bord intègre le solde au patrimoine net mais
  exclut les mouvements d'investissement de la ventilation
  revenus/dépenses — les mouvements sur ces comptes sont des
  transferts de vos propres fonds, pas des dépenses.

À utiliser pour les comptes-titres, PEA/PEA-PME, assurance-vie, et
tout compte dont le solde est de l'argent qui vous appartient sans
être destiné aux dépenses courantes.

## Argent bloqué : *Disponible* vs *bloqué*

Pour les comptes qui hébergent des fonds non retirables à la demande
— PEA, dépôt à terme, épargne bloquée — la carte peut afficher le
*Disponible* et le *bloqué* côte à côte :

- Renseignez une **période de blocage** (en années) sur le compte.
- Toute transaction antérieure à `aujourd'hui − périodeBlocage` est
  considérée comme bloquée ; le reste est *Disponible*.
- La carte affiche `dont X bloqués` quand la répartition n'est pas
  nulle.

Une transaction individuelle peut aussi porter sa propre surcharge
de blocage : un retrait anticipé bascule ce montant vers
*Disponible* sans toucher au reste.

## Réorganiser les comptes

La grille *Comptes* accepte le glisser-déposer via la poignée à six
points en haut à droite de chaque carte. L'ordre est enregistré dès
que vous relâchez. Il est repris partout : sélecteur de comptes du
tableau de bord, filtre des transactions, légende de la courbe du
solde.

Le réordonnancement au clavier fonctionne aussi : tabulez jusqu'à la
poignée, *Espace* pour saisir, flèches pour déplacer, *Espace* pour
déposer.

## Fusionner des comptes en doublon

Si vous avez créé par erreur deux comptes pour un même compte réel
— cas fréquent quand deux banques listent toutes deux un compte
joint — utilisez l'action **menu ⋮ → Fusionner avec…** sur la carte
en doublon.

La fenêtre de fusion ne propose que des destinations de même devise.
Elle déplace toutes les transactions de la source vers la cible,
additionne le solde d'ouverture de la source à celui de la cible,
repointe les points de contrôle et les motifs de nom de fichier,
puis supprime la source. L'action est irréversible ; Athena vous
avertit avant exécution.

Les liens de virement interne entre la source et d'autres comptes
sont rompus par la fusion — relancez la catégorisation si vous vous
appuyez sur la détection des virements.

## Points de contrôle sur la carte de compte

Chaque carte de compte comporte en bas un tiroir dépliant
*« points de contrôle »* — la même surface que celle décrite dans
la visite guidée d'import. Les points de contrôle ancrent le solde
courant sur un relevé bancaire, si bien qu'une dérive apparaît
comme un écart visible sur la courbe.

La visite complète (ajouter un point de contrôle, en modifier un,
et ce que signifient les losanges sur la courbe) se trouve sur la
page [Import](importing.md) — voir la section *« Points de contrôle
du solde »*, référencée depuis le tiroir.

## L'onglet Données

Tout ce qui touche aux fichiers vit sous **Données** dans la
navigation principale. Quatre sous-onglets :

| Sous-onglet | Rôle |
|-------------|------|
| **Imports** | Déposez vos fichiers OFX / CSV / PDF et regardez-les arriver. Dépôts multi-fichiers, résumé par fichier et journal d'audit des imports précédents vivent ici. Voir [Import](importing.md). |
| **Doublons** | Athena déduplique silencieusement à l'import, mais si un doublon passe (même jour, même montant, libellé différent), le panneau Doublons présente les candidats côte à côte et vous laisse fusionner ou ignorer. |
| **Modèles PDF** | Les modèles peints par l'assistant lors du premier import. Renommez, inspectez ou supprimez-les ici. Supprimer un modèle renvoie le prochain PDF correspondant vers l'assistant. |
| **Sauvegarde** | Exportez tout (comptes, catégories, règles, transactions, points de contrôle, journal d'imports) dans une enveloppe JSON unique, ou restaurez depuis une telle enveloppe. La restauration est destructrice — Athena confirme avant d'écraser. Voir [Sauvegarde et restauration](backup-recovery.md). |

L'onglet Données est volontairement le seul endroit qui touche à
des fichiers. Si vous cherchez un contrôle qui lit ou écrit quelque
chose d'externe, il se trouve sur l'un de ces quatre écrans.

## Pour aller plus loin

- **[Import](importing.md)** — tous les formats, la peinture des
  modèles, les points de contrôle en détail.
- **[Catégorisation](categorization.md)** — une fois les
  transactions dans les comptes, rangez-les par catégorie.
- **[Sauvegarde et restauration](backup-recovery.md)** — le contrat
  d'export/import complet, et les emplacements du dossier de
  données par système d'exploitation.

← [Retour aux docs utilisateur](README.md)
