---
title: Double authentification
sidebar_position: 7
---

# Double authentification (TOTP)

Ajoutez un second facteur à votre connexion pour qu'un mot de passe
volé, à lui seul, ne suffise plus à prendre le contrôle de votre
Athena. La 2FA est **optionnelle et par utilisateur** — chaque compte
décide s'il l'active, et l'étape supplémentaire ne s'affiche à la
connexion que pour les comptes qui ont choisi de s'inscrire.

La 2FA d'Athena utilise la norme RFC 6238 (TOTP) : un code à 6
chiffres qui change toutes les 30 secondes, généré par n'importe quelle
application authentificatrice que vous utilisez déjà (Google
Authenticator, Aegis, 1Password, Bitwarden, Ente Auth…). Pas de SMS,
pas d'e-mail, pas de notification — uniquement l'application sur votre
téléphone (ou une clé matérielle qui l'émule).

## Quand s'inscrire

Une installation en mono-utilisateur sur un serveur familial derrière
un LAN de confiance reste tolérable sans 2FA : l'accès physique
contrôle le périmètre et Athena n'est pas exposée à Internet public.
Activez-la si l'une de ces situations s'applique :

- Vous avez réutilisé le mot de passe Athena ailleurs (une fuite sur
  un autre service livre alors une connexion valide ici).
- Une personne du réseau local pourrait apercevoir un mot de passe
  noté ou enregistré.
- Vous avez exposé Athena au-delà du LAN (tunnel inverse, VPN
  Tailscale, redirection de port nginx sur le routeur).
- Vous voulez simplement une assurance supplémentaire —
  l'inscription prend environ une minute et se désactive en quelques
  clics.

## S'inscrire

*Réglages → Sécurité → Double authentification (2FA) → Activer*.

1. **Confirmez votre mot de passe.** Athena demande le mot de passe
   actuel avant de générer le secret. Cela empêche qu'une session
   volée n'inscrive silencieusement un facteur qu'un attaquant
   contrôle, vous verrouillant hors de votre propre compte.
2. **Scannez le QR code.** Ouvrez votre application authentificatrice,
   ajoutez un nouveau compte, et scannez le QR. Si l'application ne
   peut pas lire de QR (authentificateur matériel, configuration
   sans écran), la **clé manuelle** affichée sous le QR est le même
   secret en base32 — saisissez-la manuellement.
3. **Saisissez le code à 6 chiffres** affiché par l'application et
   cliquez sur **Vérifier**. Cela prouve que le secret est bien
   arrivé dans l'application avant qu'Athena ne bascule le compte
   sur l'état « 2FA active ».
4. **Sauvegardez vos codes de récupération.** Dix codes à usage
   unique sont affichés une seule fois, juste après l'étape de
   vérification. Imprimez-les, collez-les dans votre gestionnaire de
   mots de passe, ou sauvez-les dans un fichier chiffré — n'importe
   où qui survivra à la perte de votre téléphone. Vous ne pouvez
   plus les revoir après la fermeture du modal, mais vous pouvez en
   régénérer un nouveau lot à tout moment (ce qui invalide les
   précédents).

Fermer le modal avant l'étape finale abandonne l'inscription : le
secret en attente est jeté et la 2FA reste désactivée. Rien à
nettoyer.

## Se connecter avec la 2FA

Une fois inscrit, le parcours de connexion gagne une seconde étape :

1. Saisissez votre identifiant et votre mot de passe sur l'écran de
   connexion, comme d'habitude.
2. Lorsque le mot de passe est correct, l'écran bascule sur un champ
   **code à 6 chiffres**. Ouvrez votre application authentificatrice
   et saisissez le code actuel pour Athena.
3. Si vous n'avez pas l'application sous la main (téléphone perdu,
   batterie vide), cliquez sur **Utiliser un code de récupération**
   et saisissez un des codes que vous avez sauvegardés à
   l'inscription. Les codes sont à usage unique — le compteur dans
   les Réglages diminue de un à chaque code brûlé.
4. Le lien **Se déconnecter** en bas vous ramène à l'étape 1 sans
   compléter le second facteur — utile si vous avez commencé la
   connexion sur le mauvais compte.

Le code à 6 chiffres tolère ±30 s de dérive, donc un petit décalage
d'horloge entre votre téléphone et le serveur Athena ne fait pas
échouer la vérification.

## Codes de récupération

- **10 codes, à usage unique chacun.** Un code utilisé pour se
  connecter ne peut plus jamais servir. Le nombre de codes restants
  est affiché dans *Réglages → Sécurité → Double authentification*.
- **Ils sont hachés au repos** (argon2id, mêmes paramètres que votre
  mot de passe). Même avec un accès à la base, on ne peut pas
  récupérer les codes en clair.
- **Quand vous n'en avez plus**, TOTP continue de fonctionner —
  seule la voie de récupération est fermée. Régénérez un nouveau lot
  depuis la page Sécurité.
- **Régénérer invalide immédiatement chacun des codes précédents** et
  demande à nouveau votre mot de passe de compte. Vous verrez le
  même modal « à sauvegarder maintenant » que lors de l'inscription.

Perdre votre téléphone **et** vos codes de récupération en même
temps vous verrouille définitivement hors du compte — le secret est
chiffré au repos et ne peut être réinitialisé sans accès au serveur.
Conservez les codes séparément de l'appareil qui génère les codes
TOTP.

## Désactiver

*Réglages → Sécurité → Double authentification → Désactiver*.

La désactivation exige **à la fois** votre mot de passe actuel **et**
un code TOTP ou de récupération valide. Ni l'un ni l'autre à eux
seuls ne suffisent — ainsi un mot de passe fuité ne peut pas
désactiver la 2FA de son côté, et un appareil déverrouillé volé non
plus.

En cas de succès, le secret chiffré et l'ensemble des codes de
récupération sont supprimés de la base. Se réinscrire plus tard
reprend le même parcours de zéro et génère un nouveau secret + de
nouveaux codes.

## Sauvegardes et migration vers une nouvelle machine

**La 2FA n'est délibérément pas incluse dans les sauvegardes.** Le
compte est lié à l'installation Athena spécifique qui a généré le
secret, comme un cookie de session est lié à un navigateur précis.
Restaurer une sauvegarde JSON dans une nouvelle installation Athena
rapatrie vos transactions, comptes, catégories, règles, budgets et
pièces jointes — mais l'état 2FA est laissé de côté.

Conséquence : **après une restauration sur une nouvelle
installation, connectez-vous uniquement avec votre mot de passe et
réinscrivez la 2FA de zéro**. Supprimez les anciens codes de votre
application authentificatrice une fois le nouveau secret confirmé.

C'est volontaire — traiter la 2FA comme portable signifierait que
quiconque récupère une sauvegarde peut cloner le secret et générer
des codes valides pour votre compte. La conserver par installation
oblige la machine Athena physique à faire partie de la compromission.

## Où vit le secret

Votre secret TOTP est stocké **chiffré au repos** dans la table
`user_totp` : AES-256-GCM avec une clé dérivée de votre
`SESSION_SECRET` (HKDF-SHA256), et l'identifiant utilisateur est lié
comme donnée additionnelle authentifiée. Le secret en clair n'existe
en mémoire que le temps de vérifier un code soumis.

Faire tourner `SESSION_SECRET` invalide donc tous les TOTP inscrits
— après rotation, les utilisateurs voient « Code invalide » jusqu'à
ce qu'ils se réinscrivent. C'est le même comportement qui s'applique
déjà aux cookies de session et aux identifiants bank-sync ; voir les
notes SECURITY.md pour la procédure de rotation.

## Ce que la 2FA protège — et ce qu'elle ne protège pas

**Protège contre :**

- **Un mot de passe fuité ou réutilisé.** Une personne qui n'a que
  le mot de passe ne peut pas franchir l'étape 2.
- **Un détournement silencieux de la 2FA depuis un cookie de session
  volé.** L'inscription, la désactivation et la régénération des
  codes exigent tous le mot de passe du compte — un cookie seul ne
  peut pas basculer vers un accès persistant.

**Ne protège pas contre :**

- **Une compromission du serveur lui-même.** Toute personne avec un
  shell sur la machine peut lire chaque `SESSION_SECRET` et
  déchiffrer chaque secret TOTP. Même histoire que les identifiants
  bank-sync — inhérent à toute conception auto-hébergée avec
  secrets côté serveur.
- **Un phishing ou un MitM temps-réel à l'intérieur du LAN.** Un
  proxy en direct pourrait relayer à la fois le mot de passe et le
  code actuel dans sa fenêtre de 30 secondes. HTTPS terminé par
  nginx est l'atténuation pour la voie MitM.
- **Un téléphone volé avec l'application authentificatrice
  déverrouillée.** Même classe que « mot de passe volé +
  téléphone volé » — orthogonal à TOTP. Utilisez un code PIN sur
  votre téléphone et sur votre application authentificatrice.

## Voir aussi

- [Sécurité et confidentialité](./security-and-privacy.md) — le
  modèle de sécurité global d'Athena.
- [Chiffrement au repos](./encryption-at-rest.md) — comment le
  fichier de base est protégé.
- [Sauvegarde et récupération](./backup-recovery.md) — ce que les
  sauvegardes emportent et n'emportent pas (y compris cette
  fonctionnalité).
