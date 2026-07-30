---
title: Synchronisation bancaire
sidebar_position: 4
---

# Synchronisation bancaire (Enable Banking)

La synchronisation bancaire récupère vos transactions directement auprès de votre banque, sans télécharger de relevés. Elle est **optionnelle** — [l'import de fichiers](./importing.md) (OFX/CSV/PDF) reste la méthode de base qui fonctionne toujours — et elle est conçue pour que **vous** possédiez chaque identifiant impliqué : Athena n'embarque aucune clé d'API et n'opère aucun service cloud.

## Comment ça marche

Selon les règles européennes DSP2, les banques n'exposent leurs API de comptes qu'à des prestataires agréés. Athena passe donc par [Enable Banking](https://enablebanking.com), un AISP européen agréé dont le mode gratuit *restricted production* vous permet d'accéder à **vos propres comptes bancaires** avec vos propres identifiants d'application. Enable Banking fonctionne en pur transit : il ne conserve pas vos données bancaires — les transactions traversent leur API et atterrissent dans votre base Athena, sur votre machine. La philosophie LAN-only, sans cloud, d'Athena reste inchangée.

L'accès est strictement en **lecture seule** (information de comptes uniquement, aucune initiation de paiement), et le consentement accordé à votre banque expire après 90 à 180 jours — la reconnexion tient en une validation mobile.

## Mise en place

1. Créez un compte gratuit sur [enablebanking.com](https://enablebanking.com).
2. Dans leur Control Panel, **liez vos propres comptes bancaires** (c'est ce que permet le mode restricted — les comptes non liés ne sont jamais renvoyés par l'API).
3. Créez une **application**. Pour l'URL de redirection demandée, utilisez l'adresse de votre Athena suivie de `/bank-sync/callback` — la valeur exacte est affichée dans *Réglages → Synchronisation bancaire*. Téléchargez la clé privée RS256 générée par le Control Panel pour cette application.
4. Dans Athena, ouvrez *Réglages → Synchronisation bancaire* et collez l'**identifiant d'application** et la **clé privée** (le fichier PEM complet, lignes `BEGIN`/`END` incluses). Athena valide la paire auprès d'Enable Banking avant de l'enregistrer ; la clé est chiffrée au repos et n'est plus jamais affichée, renvoyée ni journalisée.

Ne committez jamais la clé privée dans un dépôt et ne la partagez pas — quiconque la détient peut lire les comptes que vous avez liés.

## Connecter une banque

Choisissez votre banque dans la liste et cliquez **Connecter**. Vous êtes redirigé vers la page de consentement de votre banque, vous confirmez (pour la plupart des banques françaises, une validation dans l'application mobile — la *Confirmation Mobile* du CIC/Crédit Mutuel, par exemple), puis vous revenez dans Athena. Associez ensuite chaque compte bancaire à un compte Athena — les comptes marqués *Ignorer* ne sont pas synchronisés. L'association se modifie à tout moment depuis les Réglages.

## Synchronisation

Une fois connecté, Athena synchronise automatiquement **une fois par nuit** (désactivable avec `BANK_SYNC_AUTO=0`, voir la [référence de configuration](../reference/configuration.md)), et chaque carte de connexion propose un bouton **Synchroniser** pour un rafraîchissement immédiat.

Les transactions synchronisées passent par exactement le même pipeline que les imports de fichiers : déduplication (une synchro qui chevauche un relevé déjà importé ne crée aucun doublon), règles de catégorisation, détection des virements internes et détection des séries récurrentes. Chaque lot de synchro apparaît dans *Données → Imports* comme une entrée `bank-sync`.

## Cycle de vie du consentement

Les consentements DSP2 expirent après 90 à 180 jours selon la banque. Chaque carte de connexion indique où vous en êtes :

- **« Connecté jusqu'au \<date\> »** — tout va bien, les synchros tournent sans intervention.
- **« Reconnexion requise avant le \<date\> »** — le consentement se termine sous deux semaines ; cliquez **Reconnecter** quand cela vous arrange.
- **Reconnexion requise** — le consentement a expiré ou la banque l'a révoqué ; la synchro est en pause pour cette connexion jusqu'à la reconnexion (une validation mobile, même parcours que la première connexion).

## Confidentialité

- Vos transactions transitent par l'API d'Enable Banking mais n'y sont pas conservées ; elles ne vivent que dans votre base Athena.
- La clé privée de votre application est chiffrée au repos avec une clé dérivée du `SESSION_SECRET` de votre serveur ; aucun endpoint ne la renvoie jamais.
- Révoquer l'accès reste toujours possible : déconnexion dans Athena, révocation du consentement auprès de votre banque, ou suppression de l'application sur enablebanking.com.

## Une réserve honnête

Le mode restricted production d'Enable Banking est un palier d'évaluation gratuit, pas un produit contractuel — ses conditions pourraient changer un jour (un service prédécesseur, GoCardless Bank Account Data, a fermé son offre gratuite en 2025). C'est exactement pour cela que l'import de fichiers reste le chemin de premier rang d'Athena, la synchronisation bancaire étant une couche optionnelle par-dessus.

## Dépannage

- **« Enable Banking a refusé ces identifiants » à l'enregistrement** — l'identifiant d'application et la clé privée ne correspondent pas, le fichier de clé est tronqué, ou l'application a été désactivée. Retéléchargez la clé depuis le Control Panel et collez le PEM entier.
- **« Clé privée invalide »** — le texte collé n'est pas une clé privée PEM. Collez le fichier complet, `-----BEGIN PRIVATE KEY-----` inclus.
- **La banque n'apparaît pas dans la liste** — la liste montre les banques françaises par défaut ; vérifiez que la banque figure dans la [couverture](https://enablebanking.com/coverage/) d'Enable Banking.
- **La redirection n'atteint jamais Athena** (l'URL whitelistée ne correspond pas à l'adresse à laquelle vous consultez Athena, ou le Control Panel a refusé votre URL LAN) — le code d'autorisation figure quand même dans la barre d'adresse de la page finale. Copiez cette URL complète et collez-la dans *Réglages → Synchronisation bancaire → « Finaliser manuellement »* ; Athena en extrait le code et crée la connexion. Rappel : l'URL de redirection ne doit être accessible que par **votre navigateur**, jamais par Enable Banking — une adresse LAN comme `http://192.168.1.20:8080/bank-sync/callback` est le cas normal.
- **La page de retour affiche une erreur** — le code d'autorisation est à usage unique et de courte durée ; relancez la connexion depuis les Réglages.
- **Une connexion reste sur « Reconnexion requise »** — c'est l'état attendu après expiration du consentement ; cliquez **Reconnecter** et validez sur votre téléphone.

## Voir aussi

- [Importer](./importing.md) — imports de fichiers, déduplication, assistant PDF.
- [Référence de configuration](../reference/configuration.md) — `BANK_SYNC_AUTO` et toutes les autres variables d'environnement.
- [Sécurité et confidentialité](./security-and-privacy.md) — le modèle de sécurité global d'Athena.
