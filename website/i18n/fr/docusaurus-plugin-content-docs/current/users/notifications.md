---
title: Notifications
sidebar_position: 6
---

# Notifications

Athena peut vous alerter quand quelque chose dans vos comptes franchit un
seuil que vous avez fixé : un gros achat, un solde bas, une enveloppe
dépassée ou une synchronisation bancaire en échec. Tout tourne sur votre
propre serveur. Les alertes sont calculées localement et transmises par la
connexion que votre navigateur a déjà ouverte, sans aucun service cloud.

Les alertes se configurent dans *Réglages → Notifications*. Un interrupteur
général active ou coupe toute la fonctionnalité. Les réglages en dessous sont
répartis sur trois onglets :

- **Canaux** : où les alertes apparaissent (notification dans l'application,
  notification du navigateur et, en option, WhatsApp via CallMeBot ou un
  salon Discord).
- **Confidentialité** : ce qu'une notification a le droit d'afficher à
  l'écran.
- **Alertes** : quels déclencheurs sont actifs et avec quels seuils.

Chaque déclencheur a son propre interrupteur dans l'onglet *Alertes*, pour
n'activer que ceux qui vous intéressent. Les nouvelles alertes apparaissent
en pastille sur l'icône cloche de l'en-tête et dans la boîte de réception, à
l'adresse */notifications*.

## Notifications du navigateur sur un réseau local (HTTP)

Athena tourne sur votre propre serveur, et la plupart des installations
domestiques y accèdent en HTTP simple sur une IP locale, sans certificat
HTTPS. Chrome considère ces origines comme **non sécurisées** et refuse d'y
accorder la permission `Notification`. La case *Notification du navigateur*
dans *Réglages → Notifications → Canaux* restera alors décochée, quel que
soit le nombre de tentatives, parce que le navigateur ignore la demande de
permission sans rien dire.

Pour contourner le problème et forcer Chrome à traiter votre adresse locale
comme sécurisée :

1. Ouvrez Chrome et allez sur
   `chrome://flags/#unsafely-treat-insecure-origin-as-secure`.
2. Passez **Insecure origins treated as secure** sur *Enabled*.
3. Dans la zone de texte qui apparaît, saisissez l'adresse de votre serveur
   Athena, schéma et port compris, par exemple `http://<ip-lan>:<port>`.
   Plusieurs origines peuvent être séparées par des virgules.
4. Relancez Chrome quand il vous le propose.

![Flag Chrome « Insecure origins treated as secure » réglé sur Enabled, avec une adresse locale masquée dans la liste des origines](/img/users/en/notifications-chrome-flag.svg)

Après le redémarrage, ouvrez Athena à l'adresse exacte que vous avez
autorisée, retournez dans *Réglages → Notifications → Canaux* et cochez
*Notification du navigateur* : Chrome affichera alors la demande de
permission normalement.

:::caution

Le flag s'applique à tous les onglets de ce profil Chrome qui chargent
l'origine autorisée. Gardez donc une liste courte (votre serveur Athena, rien
d'autre). Firefox et Safari n'ont pas d'équivalent. La solution durable, quel
que soit le navigateur, est de placer Athena derrière HTTPS (une autorité de
certification locale, Tailscale, ou un reverse proxy avec un vrai
certificat).

:::

## WhatsApp via CallMeBot

Les alertes peuvent aussi arriver sur votre téléphone sous forme de messages
WhatsApp, relayés par
[CallMeBot](https://www.callmebot.com/blog/free-api-whatsapp-messages/), un
relais tiers gratuit. Rien n'est envoyé à CallMeBot tant que vous n'avez pas
rempli et activé ce canal :

1. Suivez l'activation unique de CallMeBot depuis votre téléphone pour
   obtenir une clé API à 7 chiffres liée à votre numéro.
2. Dans *Réglages → Notifications → Canaux*, ouvrez la carte **WhatsApp
   (CallMeBot)**, saisissez le numéro de téléphone (format international) et
   la clé API, puis cliquez **Enregistrer les paramètres CallMeBot**.

Une fois le canal configuré, chaque notification émise par le serveur
déclenche aussi une requête vers `api.callmebot.com/whatsapp.php` avec le
titre et le corps du message. Les masques de l'onglet **Confidentialité**
s'appliquent comme pour les autres canaux, si bien que le numéro de téléphone
et la clé API sont les seules données qui quittent votre serveur. Si
CallMeBot est injoignable, la boîte de réception et la notification du
navigateur ne sont pas affectées.

**Limite de débit** : la carte propose un champ *Nombre max de notifications
par minute* (`0` = sans limite). Au-delà de ce quota sur une minute
glissante, les alertes en trop ne partent pas sur WhatsApp. La boîte de
réception et la notification du navigateur les reçoivent quand même. Un
envoi en échec ne compte pas dans le quota, et le bouton *Envoyer un test*
l'ignore complètement.

## Discord

Les alertes peuvent aussi être publiées dans un salon Discord via un
[webhook](https://support.discord.com/hc/fr/articles/228383668). Rien n'est
envoyé à Discord tant que vous n'avez pas collé l'URL d'un webhook et activé
le canal :

1. Dans Discord, ouvrez *Paramètres du serveur → Intégrations → Webhooks →
   Nouveau webhook*, choisissez le salon cible, puis **Copier l'URL du
   webhook**.
2. Dans *Réglages → Notifications → Canaux*, cochez **Discord (webhook)**,
   collez l'URL, puis cliquez **Enregistrer les paramètres Discord**.
3. Cliquez *Envoyer un test* pour vérifier que le message arrive bien dans le
   salon.

Seuls les webhooks officiels de Discord sont acceptés :
`https://discord.com/api/webhooks/<id>/<jeton>`, ainsi que les variantes
`discordapp.com`, `ptb.discord.com` et `canary.discord.com`. Le formulaire
signale toute autre URL, et le serveur la refuse aussi : Athena ne peut donc
jamais être dirigé vers une machine de votre réseau local ni vers un autre
site.

Traitez l'URL du webhook comme un mot de passe : quiconque la possède peut
écrire dans ce salon. Elle reste sur votre serveur et ne sert qu'au moment où
une notification part. Les messages passent par les mêmes masques
**Confidentialité** que les autres canaux, donc les montants et marchands
masqués ne quittent jamais votre serveur.

Chaque alerte est publiée en un seul message : le titre en gras, le corps en
dessous (coupé à la limite de 2 000 caractères de Discord). Les mentions sont
désactivées, si bien qu'un libellé de marchand contenant `@everyone` ou
`@here` ne notifiera pas tout le salon. Si Discord est indisponible ou si le
webhook a été supprimé, l'envoi échoue sans message d'erreur. La boîte de
réception et la notification du navigateur reçoivent quand même l'alerte.

**Limite de débit** : *Nombre max de notifications par minute* fonctionne
comme pour WhatsApp (`0` = sans limite). Au-delà de ce quota sur une minute
glissante, les alertes en trop ne partent pas sur Discord, et seulement sur
Discord. Un envoi en échec ne compte pas dans le quota, et le bouton
*Envoyer un test* l'ignore. Le compteur est gardé en mémoire : un
redémarrage du serveur le remet à zéro.

## Grosse transaction

Se déclenche quand une transaction dépasse, sur un compte, le montant que
vous avez fixé pour ce compte. Le seuil se règle compte par compte dans la
carte « Grosse transaction » de l'onglet *Alertes*. Laissez un compte vide
pour ne jamais être alerté dessus. Si plusieurs transactions concernées
arrivent en même temps (un import, une synchro bancaire), Athena attend
quelques secondes et envoie une seule notification récapitulative au lieu
d'une par ligne.

## Solde bas

Se déclenche quand une transaction fait passer le solde d'un compte sous le
plancher que vous avez fixé pour ce compte, avec la même présentation compte
par compte que la carte des grosses transactions. Une seule alerte de solde
bas est envoyée par compte et par jour : une série de petits achats alors que
vous êtes déjà sous le plancher n'inonde pas la boîte de réception.

## Enveloppe dépassée

Se déclenche quand les dépenses d'une enveloppe budgétaire dépassent son
plafond pour le mois en cours. Ce déclencheur n'a qu'un interrupteur : le
plafond est celui que vous avez déjà fixé sur l'enveloppe dans *Budgets →
Enveloppes*. Au plus une alerte est envoyée par enveloppe et par mois.

## Échec de synchronisation bancaire

Se déclenche quand une [synchronisation bancaire](./bank-sync) planifiée ou
manuelle échoue pour un compte connecté : consentement expiré, panne
d'Enable Banking ou problème d'association. Au plus une alerte est envoyée
par compte et par jour, donc une synchro qui échoue toute la journée ne
remplit pas votre boîte de réception. La raison s'affiche sur la carte de
connexion dans *Données → Synchronisation bancaire*.

## Mode confidentialité

Par défaut, les notifications masquent les deux informations les plus
sensibles si quelqu'un jette un œil à votre écran ou à un aperçu sur l'écran
verrouillé :

- **Masquer le montant** : remplace le montant par un texte générique dans le
  titre et le corps de la notification.
- **Masquer le marchand** : remplace le marchand ou le libellé par une
  description générique du déclencheur au lieu du texte de la transaction.

Les deux sont activés par défaut et se désactivent séparément dans l'onglet
*Confidentialité* des réglages de notifications, si vous préférez voir les
vrais chiffres. La boîte de réception, à l'adresse */notifications*, affiche
toujours le détail complet de la transaction. Les options de confidentialité
s'appliquent à tout ce qui sort de la boîte de réception : notifications dans
l'application, notifications du navigateur, messages WhatsApp et Discord.
Tous apparaissent dans des endroits plus exposés, comme un écran verrouillé,
un salon Discord partagé ou quelqu'un qui regarde par-dessus votre épaule.

## Voir aussi

- [Synchronisation bancaire](./bank-sync) : connexions, cycle de vie du
  consentement et dépannage de la synchro.
- [Tableau de bord](./dashboard) : où se règlent les budgets et les
  enveloppes.
