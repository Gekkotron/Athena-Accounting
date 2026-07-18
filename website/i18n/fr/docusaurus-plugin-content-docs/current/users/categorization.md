---
title: Catégorisation
sidebar_position: 4
---

# Catégorisation

Athena catégorise les transactions de deux façons : des **règles** qui
s'exécutent à chaque import, et une **assignation manuelle** via
l'onglet Tri. Chaque transaction porte un tag de **source** — `auto`,
`default` ou `manual` — qui détermine qui possède sa catégorie la
prochaine fois que les règles sont ré-appliquées. Cette page parcourt
les deux chemins, comment les règles de virement gardent les
mouvements internes hors de vos totaux de revenus et de dépenses, et
ce que « régénérer les catégories » fait réellement.

## Le moteur de règles

Les règles sont des associations mot-clé → catégorie configurées dans
**Règles**. À chaque import, Athena parcourt vos règles actives par
ordre de priorité (la plus haute d'abord, égalités départagées par
l'id de règle) et applique la catégorie de la première règle qui
matche. Les transactions non matchées tombent dans la catégorie par
défaut `Divers`.

La correspondance est :

- **Insensible aux accents et à la casse.** `carrefour`, `CARREFOUR`
  et `Carrefour` matchent tous — Athena normalise le mot-clé et le
  libellé de la transaction avant de comparer.
- **Mot entier par défaut.** `paye` ne matchera pas `payweb`. Passez
  une règle en **Sous-chaîne** pour un match plus souple, ou en
  **Regex** pour un contrôle total (le motif s'applique au libellé
  déjà normalisé).
- **Gardée par le signe.** Une règle peut être restreinte aux
  montants positifs ou négatifs uniquement. C'est ainsi qu'on empêche
  une règle `salaire` d'attraper un remboursement sur votre carte, ou
  une règle `carrefour` d'attraper un remboursement de Carrefour.

Créez des règles depuis la page **Règles** : tapez un ou plusieurs
mots-clés (séparés par des virgules), choisissez une catégorie, réglez
le mode de correspondance, la contrainte de signe et la priorité.
Chaque mot-clé devient sa propre règle pointant vers la même
catégorie.

## L'onglet Tri

L'onglet Tri est l'endroit où vous traitez tout ce que les règles
n'ont pas attrapé. Athena regroupe les transactions non catégorisées
(et celles tombées dans `Divers`) par **libellé normalisé** — donc
`CARREFOUR CITY 12/03` et `CARREFOUR MARKET 04/06` atterrissent dans
le même groupe — et trie les groupes par fréquence, de sorte que les
plus gros gains sont toujours en haut.

### Assignation en masse

Cochez la case en face de chaque groupe à traiter, choisissez une
catégorie dans la liste **En masse**, et cliquez sur **Appliquer à la
sélection**. Toutes les transactions de tous les groupes sélectionnés
sont assignées d'un coup.

### Assignation d'un seul groupe

Vous préférez traiter les groupes un par un ? Chaque ligne a sa propre
liste déroulante de catégorie et un lien **Appliquer** à droite. Même
effet, un groupe à la fois.

### Transformer une assignation en règle

La case **Créer des règles** (cochée par défaut) demande à Athena de
créer aussi une règle sur le libellé normalisé du groupe pendant
l'assignation. Ainsi, le `CARREFOUR CITY 04/07` du mois prochain sera
attrapé automatiquement au moment de l'import — vous ne payez le coût
du tri qu'une seule fois par enseigne. Décochez la case pour trier
sans laisser de règles derrière.

## Régénérer les catégories

Le bouton **Recatégoriser** (en haut à droite de **Règles** et de
**Tri**) rejoue toutes les règles actives sur toutes les transactions
existantes. Utilisez-le après avoir ajouté de nouvelles règles,
changé des priorités, ou importé un historique antérieur à ces
règles.

Par défaut, **vos choix manuels sont préservés** : seules les
transactions dont la source est `auto` (déjà matchées par une règle)
ou `default` (tombées dans `Divers`) sont ré-évaluées. Tout ce que
vous avez touché à la main garde sa catégorie. Le bandeau de résultat
affiche quatre compteurs : total scanné, recatégorisées,
non-catégorisables restantes et manuelles préservées.

## Règles de virement interne

Quand vous transférez de l'argent entre deux de vos propres comptes,
les deux jambes atterrissent dans vos imports comme des lignes de
dépense et de revenu ordinaires. Le détecteur de virement d'Athena
les apparie via un `transfer_group_id` partagé et les exclut des
agrégats revenus/dépenses pour qu'ils ne gonflent pas vos totaux.

Les règles de virement vivent à `/api/transfer-rules` et associent un
**mot-clé** (par ex. `virement compte joint`) à une **direction**
(`outgoing` ou `incoming`) et, optionnellement, à un compte homologue
spécifique. Une fois qu'une règle matche une jambe entrante, Athena
cherche la jambe miroir dans le compte homologue à ±7 jours et relie
les deux. L'interface pour ces règles est actuellement minimale — la
plupart des utilisateurs les configurent via l'API ou en important
une sauvegarde qui les contient déjà.

## Comment les sources interagissent

Chaque transaction stocke une **source** qui dit à Athena d'où vient
sa catégorie :

- **`auto`** — assignée par le moteur de règles à l'import.
- **`default`** — est passée à travers toutes les règles et a
  atterri dans `Divers`.
- **`manual`** — vous avez réglé la catégorie, depuis l'onglet Tri,
  depuis l'édition en ligne d'une transaction ou depuis la fenêtre de
  transaction.

La source pilote deux comportements :

- **Édition.** Assigner une catégorie sur une transaction — en ligne
  dans le tableau, dans la fenêtre modale ou via l'onglet Tri —
  bascule sa source à `manual`. La ré-application rétroactive des
  règles la laisse alors tranquille.
- **Ré-import.** Ré-importer le même fichier est sûr : la dédup saute
  les lignes déjà présentes (voir [Importer](importing.md)), donc vos
  choix manuels survivent aux ré-imports sans être touchés. Les
  nouvelles transactions du fichier sont catégorisées par le moteur
  de règles et démarrent leur vie en `auto` ou `default` — jamais en
  `manual`.

Pour effacer les surcharges manuelles et repartir de zéro, lancez
**Recatégoriser** en passant `{"preserveManual": false}` directement à
l'API — l'interface utilise toujours le mode sûr (préservant).

*Voir aussi :* [Importer](importing.md) · [Tableau de bord](dashboard.md)

← [Retour aux docs utilisateur](README.md)
