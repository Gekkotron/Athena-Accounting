---
title: Objectifs d'épargne
sidebar_position: 6
---

# Objectifs d'épargne

Réservez une partie d'un compte pour un usage précis — des vacances, un
fond d'urgence, le prochain gros achat — sans découper le compte
lui-même. Un objectif est une **intention** posée au-dessus du solde
réel : il ne bouge pas un euro de votre ledger, et créer un objectif ne
crée pas de transaction. Vous enregistrez versements et retraits sur
l'objectif séparément.

Comme les objectifs vivent au-dessus du ledger, un même compte peut en
héberger autant que vous le souhaitez. Un seul Livret A peut porter
*Vacances 2 000 €* à côté de *Fond d'urgence 5 000 €* à côté d'un
*Buffer* général, et la progression de chacun se suit indépendamment.

## What a savings goal is

Chaque objectif comporte :

- **Un nom** — libre, jusqu'à 128 caractères.
- **Un montant cible** — strictement positif, dans la devise du compte
  (Athena n'a pas encore de conversion — voir
  [Comptes et données](accounts-and-data)).
- **Une date cible** — optionnelle. Elle alimente la projection
  « X € / mois pour tenir la date » et l'avertissement « en retard de
  N jours ».
- **Une couleur** — accent optionnel.
- **Un historique d'événements** — chaque versement et chaque retrait,
  avec une date et éventuellement une note.

Il n'y a pas d'énumération de statut. Un objectif est soit *ouvert*
(`closed_at` NULL), soit *clos* (archivé, non-null). Clore un objectif
ne supprime rien — vous pouvez le rouvrir plus tard, ou le supprimer
explicitement si vous voulez effacer l'historique.

## Creating a goal

Deux points d'entrée :

- **Depuis la page Objectifs** (`Objectifs` dans la barre latérale) : le
  bouton *Nouvel objectif* ouvre une modale pour choisir le compte, le
  nom, la cible et — optionnellement — une échéance et une couleur.
- **Depuis la page Comptes** : chaque carte de compte porte une bande
  compacte *Objectifs* avec une puce `+ Nouvel objectif` qui ouvre la
  même modale, pré-sélectionnée sur ce compte.

Athena rejette une cible non positive (erreur 400 affichée en ligne) et
un couple `(compte, nom)` en doublon (409 avec un message en français).
L'unicité du nom est portée par compte — vous pouvez avoir *Vacances*
sur le Livret A et *Vacances* sur le Compte courant sans conflit.

## Recording a contribution or a withdrawal

Ouvrez un objectif (cliquez sur une carte) et utilisez le formulaire
*Enregistrer un versement* dans le tiroir :

- **Montant** — les nombres positifs sont des versements, les négatifs
  des retraits. Zéro est refusé.
- **Date** — par défaut aujourd'hui. N'importe quelle date est acceptée,
  y compris des dates passées pour un rattrapage.
- **Note** — optionnelle, plafonnée à ~500 caractères.

L'événement se pose dans le ledger *de l'objectif*, pas dans celui du
compte sous-jacent. Le solde réel du compte n'est pas touché.

**Cible atteinte ?** La réponse d'Athena inclut un drapeau `justReached`
sur la transition qui franchit la cible depuis le dessous — l'app
déclenche un toast de succès unique. Les objectifs ne se ferment pas
automatiquement à l'atteinte ; vous les clôturez explicitement quand
vous êtes prêt à les archiver. Un dépassement est autorisé et s'affiche
comme « 108 % réalisé » sur la carte.

## Deadlines and projections

Quand vous définissez une date cible :

- **Date future** — la carte affiche `↣ X € / mois pour tenir la date`.
  Le calcul est `ceil((cible − épargné) / mois restants)` où les mois
  sont la moyenne grégorienne (30,44 jours), arrondi au supérieur — le
  conseil pèche donc toujours du côté « un peu plus que le strict ».
- **Date passée + toujours sous la cible** — la carte affiche
  `en retard de N jours`. La projection mensuelle disparaît ; poser une
  nouvelle date cible la ramène.
- **Date passée + déjà atteint** — Athena considère l'objectif comme
  fait et masque les deux clauses. Vous n'avez plus qu'à le clore.
- **Sans date cible** — les deux clauses sont masquées. C'est le bon
  choix pour une épargne ouverte (un fond d'urgence).

## Closing versus deleting

- **Clore** (`Clore l'objectif`) archive l'objectif. Il disparaît de la
  liste par défaut, mais la bascule *Afficher les objectifs clos* le
  fait ressortir. Les événements sont conservés. Cloturez un objectif
  atteint pour alléger l'écran ; cloturez un objectif obsolète pour la
  même raison.
- **Rouvrir** inverse la bascule — aucune donnée n'a été perdue.
- **Supprimer** (bouton rouge en bas du tiroir, protégé par une
  confirmation) retire l'objectif *et* tous ses événements. C'est
  irréversible.

## The Comptes strip and the Dashboard widget

Au-delà de la page Objectifs dédiée :

- **Comptes → chaque carte de compte** — une bande compacte *Objectifs*
  liste les objectifs non-clos du compte avec une mini barre de
  progression. Cliquer sur une ligne déclenche un lien profond vers
  `/goals?highlight=<id>`, qui fait défiler l'objectif à l'écran et le
  cerne d'un anneau. La puce `+ Nouvel objectif` renvoie vers la même
  page avec la modale de création ouverte sur le bon compte.
- **Dashboard → Objectifs à venir** — jusqu'à trois objectifs triés par
  date cible la plus proche (nulls en dernier, tie-break sur le moins
  rempli). La section ne s'affiche pas si vous n'avez pas d'objectif.

Un avertissement ambre apparaît sur l'en-tête de la section d'un compte
quand la somme des objectifs non-clos dépasse le solde courant :
`Vous avez réservé plus que votre solde disponible sur ce compte`.
C'est purement indicatif — Athena est un ledger rétrospectif, et
l'intention précède souvent le mouvement bancaire.

## Backup

Les objectifs voyagent dans la sauvegarde JSON standard : deux tableaux
optionnels (`savingsGoals` et `savingsGoalEvents`) rejoignent le
payload. Ils utilisent des clés naturelles à la restauration :

- Un objectif est remappé par `(nom du compte, nom de l'objectif)`.
- Un événement est remappé vers l'objectif résolu via le même couple.
- Les objectifs dont le compte n'a pas été restauré sont silencieusement
  ignorés, avec le compte remonté dans le résumé de restauration. Idem
  pour les événements dont l'objectif parent manque.

Les anciennes sauvegardes (d'avant l'arrivée de cette fonctionnalité)
se restaurent sans souci — les tableaux optionnels valent par défaut
un tableau vide.

## Privacy

Tous les montants affichés sur la page Objectifs, sur la bande
AccountCard et sur la section Dashboard respectent le même flou de
confidentialité que le reste de l'app. Les nombres sont couverts par la
classe `private` et masqués quand vous activez le flou (Ctrl-J sur
desktop ; voir [Sécurité et confidentialité](security-and-privacy)).

## See also

- [Comptes et données](accounts-and-data) — comment les soldes se
  comportent et la devise du compte héritée par un objectif.
- [Catégorisation](categorization) — le ledger catégorisé vit à côté des
  objectifs mais en est indépendant.
- [Sauvegarde et restauration](backup-recovery) — d'où vient le dump
  JSON et comment les clés naturelles de restauration se résolvent.
