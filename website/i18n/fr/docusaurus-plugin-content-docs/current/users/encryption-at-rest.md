---
title: Chiffrement au repos
sidebar_position: 8
---

# Chiffrement au repos

Le « chiffrement au repos » protège le fichier de base de données lui-même
— pour qu'une personne qui met la main sur votre disque, votre sauvegarde
externe ou le système de fichiers de votre serveur ne puisse pas
simplement y lire vos comptes et transactions. Athena traite cela
différemment selon le pilote de base de données utilisé :

- **Application bureau (PGlite)** — Athena peut chiffrer le fichier de
  base de données lui-même. C'est optionnel, à activer depuis les
  Réglages.
- **Docker / serveur familial (Postgres)** — Athena ne chiffre **pas**
  les fichiers de Postgres. Les protéger relève du niveau hôte/volume,
  décrit plus bas.

## Bureau (PGlite)

Le chiffrement au repos est désactivé par défaut. Activez-le depuis
**Réglages → Sécurité → Activer le chiffrement**, où vous définissez un
mot de passe.

**Ce que l'activation change réellement.** Une fois activé, la base de
données ne vit plus sur le disque comme un cluster PGlite en clair. Elle
tourne entièrement **en mémoire** pendant que l'application est ouverte,
et la seule chose écrite sur le disque à partir de là est un unique
**instantané chiffré en AES-256-GCM**, scellé sous une clé dérivée de
votre mot de passe par scrypt. Rien de lisible n'est écrit sur le disque
*après* ce point — mais l'activation elle-même ne supprime pas
immédiatement l'ancienne copie en clair : il faut **redémarrer
l'application une fois** après l'activation pour que la migration se
termine et que l'ancien dossier de base de données en clair soit
effectivement supprimé. Tant que ce redémarrage n'a pas eu lieu, la copie
en clair reste présente sur le disque à côté du nouvel instantané chiffré.
L'instantané vit dans votre dossier de données (voir
[Installation bureau](desktop-install.md) pour son emplacement) sous
forme de deux fichiers :

- `athena.db.enc` — l'instantané chiffré courant.
- `athena.db.enc.bak` — le précédent, conservé comme filet de sécurité
  au cas où une écriture serait interrompue en pleine rotation.

**Quand l'instantané se rafraîchit.** Athena ne rechiffre pas à chaque
modification — cela mettrait le disque à rude épreuve. À la place, il
attend : environ **10 secondes** après votre dernière modification, il
écrit un instantané frais. Si vous continuez à modifier des données sans
interruption (un long import, par exemple), cette attente est repoussée
à chaque fois, mais seulement jusqu'à un **plafond de 60 secondes** —
après une minute d'écritures continues, l'instantané est forcé plutôt que
repoussé indéfiniment. Athena écrit aussi toujours un dernier instantané
lors d'une fermeture propre de l'application.

**La fenêtre de risque en cas de crash.** À cause de cette attente, un
crash brutal ou une fermeture forcée peut perdre les quelques dernières
secondes de modifications depuis le dernier instantané écrit — une
fermeture normale de l'application n'a pas ce problème, seule une sortie
brutale l'a.

**Il n'existe aucune récupération de mot de passe.** Si vous oubliez le
mot de passe de chiffrement, vos données sont perdues — il n'y a ni
réinitialisation, ni porte dérobée, ni recours au support pour les
récupérer. Votre seul filet de sécurité est une **sauvegarde exportée**
faite au préalable (**Réglages → Données → Sauvegarde** ; voir
[Sauvegarde et restauration](backup-recovery.md)). Une sauvegarde est un
fichier séparé chiffré avec **sa propre phrase secrète**, indépendante du
mot de passe de chiffrement au repos ci-dessus — vous la choisissez au
moment de l'export et elle vous est redemandée au moment de la
restauration. Cette phrase secrète de sauvegarde doit être gardée en
sécurité tout autant que le mot de passe de chiffrement : si vous perdez à
la fois le mot de passe de chiffrement et la phrase secrète de sauvegarde,
il ne reste plus rien à récupérer — le fait que la sauvegarde soit un
fichier séparé ne sert à rien si sa propre phrase secrète est également
perdue.

**Changer ou désactiver le mot de passe.** Les deux se trouvent dans
**Réglages → Sécurité**, et les deux exigent le mot de passe actuel pour
confirmer que vous y êtes autorisé :

- **Changer le mot de passe** rechiffre immédiatement l'instantané sous
  le nouveau mot de passe ; l'ancien cesse aussitôt de fonctionner pour
  cet instantané.
- **Désactiver le chiffrement** ne prend pas effet instantanément — c'est
  enregistré et appliqué **au prochain démarrage** de l'application.
  D'ici là, l'application continue de tourner exactement comme avant.

**Déverrouillage au lancement.** Une fois le chiffrement activé, démarrer
l'application affiche un écran de déverrouillage demandant votre mot de
passe avant tout autre chargement. Rien n'est déchiffré, et aucune autre
fenêtre ne s'affiche, tant que le bon mot de passe n'a pas été saisi.

## Docker / serveur familial (Postgres)

Si vous faites tourner Athena en stack Docker Compose sur Postgres, rien
de ce qui précède ne s'applique : **Athena ne chiffre pas le dossier de
données Postgres**. Toute personne ayant un accès Docker ou root sur la
machine hôte peut lire chaque compte et transaction en lignes en clair —
par exemple avec `docker exec -it <conteneur> psql -U <user> -d <db>`, ou
simplement en ouvrant les fichiers du dossier monté `./postgres-data` avec
n'importe quel outil compatible Postgres. C'est une propriété de
Postgres/Docker, pas quelque chose que la couche applicative d'Athena
peut empêcher depuis l'intérieur du conteneur.

Si cela compte pour votre installation — une machine partagée, un
ordinateur portable qui pourrait être perdu ou volé pendant qu'il tourne
— la solution est de chiffrer au niveau **volume**, pour que les fichiers
derrière `/var/lib/postgresql/data` soient illisibles sans d'abord
déverrouiller le disque sous-jacent.

**Hôte Linux : LUKS.** Placez les données Postgres sur un volume chiffré
par LUKS et montez-le, puis pointez le montage Docker Compose vers ce
montage au lieu d'un dossier hôte en clair :

```bash
cryptsetup luksFormat /dev/sdX1
cryptsetup open /dev/sdX1 athena-postgres
mkfs.ext4 /dev/mapper/athena-postgres
mkdir -p /mnt/encrypted/athena-postgres
mount /dev/mapper/athena-postgres /mnt/encrypted/athena-postgres
```

Puis surchargez le volume du service `db` avec un
`docker-compose.override.yml` à côté du `docker-compose.yml` principal :

```yaml
services:
  db:
    volumes:
      - /mnt/encrypted/athena-postgres:/var/lib/postgresql/data
```

Docker Compose fusionne automatiquement `docker-compose.override.yml`
avec `docker-compose.yml`, aucun autre changement n'est nécessaire. Ce
qui se trouvait déjà dans `./postgres-data` doit être copié une fois vers
le nouveau montage avant de relancer le stack.

Un **dataset ZFS ou Btrfs chiffré** obtient le même résultat sans couche
LUKS séparée, si votre hôte utilise déjà l'un de ces systèmes de
fichiers — créez le dataset avec le chiffrement activé et montez-le au
même chemin.

**Machines de type bureau (Docker Desktop sur un portable, par exemple).**
Le chiffrement intégral du disque couvre la même menace sans aucune
modification de la stack Compose : **FileVault** sur macOS, **BitLocker**
sur Windows. L'un comme l'autre protège tout le disque — y compris
`./postgres-data` — dès lors que la machine est éteinte ou verrouillée.

## Modèle de menace

| Scénario | Bureau (PGlite) | Docker/LAN (Postgres) |
| --- | --- | --- |
| Appareil volé ou disque retiré **hors tension** | Protégé — seul un instantané chiffré existe sur le disque (après le redémarrage qui suit l'activation ; avant ce redémarrage, la copie en clair est aussi encore présente) | Protégé, **si** vous avez mis en place le chiffrement du volume/du disque comme ci-dessus |
| Attaquant avec un accès root ou Docker **en direct** sur l'hôte en cours d'exécution | **Non protégé** — un processus en cours d'exécution peut être sollicité pour déchiffrer les données qu'il utilise déjà | **Non protégé** — un accès Docker/root lit directement la base en cours d'exécution, volume chiffré ou non |
| Mot de passe / phrase secrète perdu | Données irrécupérables, sauf sauvegarde exportée au préalable | Phrase secrète LUKS perdue ⇒ les données de ce volume sont irrécupérables |

Aucun des deux modes ne défend contre un attaquant qui contrôle déjà
l'hôte en cours d'exécution — le chiffrement au repos protège les
données **au repos** (machine éteinte, disque retiré, disque volé), pas
une machine déjà compromise.

## Secrets des sauvegardes distantes

La destination de [sauvegarde distante](backup-recovery.md#sauvegardes-distantes-planifiées)
stocke deux secrets côté serveur pour que le planificateur tourne sans
intervention : le mot de passe WebDAV et la phrase secrète de sauvegarde.
Les deux sont chiffrés au repos en AES-256-GCM sous une clé dérivée du
`SESSION_SECRET` du serveur (HKDF-SHA256), liée à l'identifiant de
l'utilisateur propriétaire — un chiffré copié sur la ligne d'un autre
utilisateur ne se déchiffre pas. Aucune réponse d'API ne les renvoie
jamais, et chaque dump poussé vers la destination est lui-même scellé
avec la phrase secrète de sauvegarde.

## Voir aussi

- [Sécurité et confidentialité](security-and-privacy.md) — le modèle de
  sécurité global (authentification, binding réseau, jetons MCP).
- [Sauvegarde et restauration](backup-recovery.md) — exporter et
  restaurer la seule copie de vos données qui ne dépend pas du mot de
  passe de chiffrement.
- [Installation bureau](desktop-install.md) — où vit `$DATA_DIR` selon
  l'OS.

← [Retour aux docs utilisateur](README.md)
