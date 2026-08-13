---
title: Sauvegarde et restauration
sidebar_position: 8
---

# Sauvegarde et restauration

Athena garde toutes vos données en local — sur votre serveur familial
(Docker) ou dans le fichier PGlite de l'application bureau. Sauvegarder,
c'est simplement produire un fichier JSON portable que vous rangez où
bon vous semble ; restaurer, c'est le renvoyer dans une installation
fraîche ou existante.

:::caution Sachez ce que contient votre export
Les fichiers d'export contiennent l'intégralité de vos comptes,
transactions, règles et budgets. Chaque export est **toujours
chiffré** — vous définissez une phrase secrète dans la boîte de
dialogue **Exporter les données**, et le fichier est scellé en
AES-256-GCM (clé dérivée par scrypt) ; il n'y a plus d'option JSON en
clair. La restauration demande cette même phrase secrète ; il n'existe
**aucune récupération** en cas de perte, traitez-la comme le mot de
passe maître d'un gestionnaire de mots de passe — et gardez-la en
sécurité indépendamment du mot de passe de chiffrement au repos de
l'application, les deux étant sans rapport : perdre les deux ne laisse
plus rien à récupérer.
:::

## Où se trouve la base ?

- **Application bureau (Tauri).** Le fichier PGlite `athena.db` vit
  dans `$DATA_DIR`, qui vaut par défaut :
  - macOS : `~/Library/Application Support/Athena Accounting/`
  - Linux : `~/.local/share/Athena Accounting/`
  - Windows : `%APPDATA%\Athena Accounting\`
  (Athena crée le dossier au premier lancement.)
- **Serveur familial (Docker).** Le volume nommé `athena_pgdata` est
  monté sur `/var/lib/postgresql/data` dans le conteneur Postgres.
  Sauvegarder le volume brut est possible, mais l'export JSON
  décrit ci-dessous est plus portable — il fonctionne d'une version
  à l'autre et se restaure aussi bien vers la version bureau que vers
  Docker.

## Exporter (via l'interface)

1. Ouvrez **Réglages → Données → Sauvegarde**.
2. Cliquez sur **Exporter les données**, saisissez une phrase secrète
   quand elle est demandée. Athena télécharge un fichier
   `athena-backup-YYYY-MM-DD-HHMMSS.enc.json`.
3. Gardez cette phrase secrète en lieu sûr — c'est le seul moyen de
   rouvrir le fichier plus tard.

Sous le capot : l'export est un `POST /api/backup/export` avec la
phrase secrète dans le corps de la requête (jamais en paramètre
d'URL, pour ne jamais atterrir dans les journaux d'accès ou
l'historique du navigateur), qui sérialise votre utilisateur avec
toutes ses relations en clés naturelles (noms de comptes, noms de
catégories) puis scelle le résultat. L'ancien `GET /api/backup/export`
en clair renvoie désormais `410 Gone`.

**Les pièces jointes des transactions sont sauvegardées séparément** via leur propre canal d'archive chiffré — voir [Pièces jointes](./attachments.md). Le dump JSON ci-dessus reste léger (structure et métadonnées uniquement) pour qu'une lourde bibliothèque de reçus ne gonfle jamais chaque sauvegarde ; les runs planifiés ne re-téléversent l'archive des pièces jointes que si elle a effectivement changé.

## Sauvegardes distantes (planifiées)

Athena peut pousser une sauvegarde chiffrée vers une destination distante **automatiquement, une fois par nuit**, depuis **Réglages → Données → Sauvegarde**, carte *Sauvegarde distante*. Chaque fichier poussé est la même enveloppe `.enc.json` toujours chiffrée qu'un export manuel — la phrase secrète configurée sur la carte scelle chaque dump, et il n'existe **aucune récupération** en cas de perte.

Les fichiers sont nommés `athena-backup-AAAA-MM-JJ-HHMMSS.enc.json`. La rétention garde les N fichiers les plus récents (*Sauvegardes conservées*, 30 par défaut) ; le nettoyage ne touche que les fichiers correspondant exactement à ce motif de nom — tout autre fichier présent dans le même dossier n'est jamais supprimé.

Une destination par utilisateur. L'enregistrement de la carte effectue une **vraie écriture de test** vers la destination avant de rien stocker — une URL erronée, un mauvais mot de passe ou un dossier non monté est rejeté immédiatement avec l'erreur sous-jacente. Lors de la modification d'une destination déjà configurée, laisser le mot de passe et la phrase secrète vides conserve ceux déjà enregistrés (ils ne sont jamais réaffichés).

### Destination WebDAV

Fonctionne avec n'importe quel serveur WebDAV. Emplacements courants :

- **Synology** — installez le paquet *WebDAV Server* ; le partage est exposé sur le port 5005 (http) ou 5006 (https).
- **Nextcloud** — utilisez le point d'accès DAV des fichiers : `https://votre-nextcloud/remote.php/dav/files/UTILISATEUR/`.

Le *Sous-dossier* optionnel range les fichiers d'Athena dans leur propre répertoire (créé automatiquement au premier envoi). Avec une URL en `http` simple, le **mot de passe** WebDAV circule en clair sur votre réseau local — acceptable sur un réseau domestique de confiance, mais bon à savoir ; le **contenu** des sauvegardes est de toute façon toujours chiffré.

La **Freebox n'a pas de serveur WebDAV** (son disque ne parle que
FTP/SMB/AFP — WebDAV est une [demande ouverte de longue date](https://dev.freebox.fr/bugs/task/37418)).
Pour sauvegarder sur un disque Freebox, utilisez la destination FTP
ci-dessous — ou la destination dossier via un montage SMB.

### Destination FTP

FTP simple en mode passif — pensé pour la Freebox, fonctionne avec
n'importe quel serveur FTP du réseau local :

- **Freebox** — activez le FTP dans Freebox OS (Paramètres de la Freebox →
  Mode avancé → **FTP**) et définissez-y le mot de passe. Serveur :
  `mafreebox.freebox.fr`, port `21`, utilisateur `freebox`. Le
  *Sous-dossier* optionnel range les fichiers d'Athena dans leur propre
  répertoire (créé automatiquement au premier envoi).

Le FTP envoie le **mot de passe** en clair sur votre réseau local (pas de
FTPS) — même compromis que le WebDAV en http simple, acceptable sur un
réseau domestique de confiance. Le **contenu** des sauvegardes est de
toute façon toujours chiffré. Les fichiers sont écrits sous un nom
temporaire puis renommés une fois complets : une connexion coupée ne
laisse jamais une sauvegarde tronquée.

### Destination dossier

Un chemin absolu sur la machine qui exécute le backend : un montage SMB/NFS, un disque externe, un dossier synchronisé. Le dossier doit déjà exister — Athena refuse volontairement de le créer, pour qu'un montage réseau absent échoue bruyamment au lieu d'écrire en silence dans un dossier local fantôme. Sous Docker, montez la cible dans le conteneur backend et pointez le chemin vers le montage.

**Exemple Freebox** — activez *Partages Windows* dans Freebox OS (Paramètres → Mode avancé), montez le partage sur l'hôte (le nom du partage est en général `Disque dur` ; `smbclient -L mafreebox.freebox.fr -N` le liste), p. ex. dans `/etc/fstab` :

```
//mafreebox.freebox.fr/Disque\040dur  /mnt/freebox  cifs  credentials=/etc/freebox-smb.cred,vers=3.0,iocharset=utf8,_netdev,x-systemd.automount  0  0
```

puis bind-montez un sous-dossier dans le conteneur backend (`/mnt/freebox/athena-backups:/backups`) et utilisez `/backups` comme chemin de dossier.

Envie d'une copie hors site sans confier d'identifiants cloud à Athena ? Pointez la destination dossier vers un répertoire que `rclone`, Syncthing ou l'outillage cloud de votre NAS réplique.

### Horaire, rétention et statut

- L'heure de sauvegarde (heure locale du serveur, 03:00 par défaut) se choisit sur la carte ; le planificateur vérifie toutes les 15 minutes et exécute **au plus une sauvegarde par utilisateur et par jour**.
- Une exécution échouée (destination injoignable, montage absent) est retentée au tick suivant (15 minutes) jusqu'à réussite ; la carte affiche la dernière erreur.
- La ligne de statut de la carte montre le dernier envoi réussi et le prochain planifié.
- `BACKUP_AUTO=0` désactive complètement le planificateur ([référence de configuration](../reference/configuration.md)) ; le bouton *Sauvegarder maintenant* reste fonctionnel.

### Restaurer depuis une copie distante

Téléchargez le fichier `.enc.json` depuis votre destination (n'importe quel client WebDAV ou explorateur de fichiers), puis suivez le flux normal de [Restauration](#restaurer-via-linterface) — il demande la même phrase secrète que celle stockée sur la carte. Testez-le une fois après la mise en place : une sauvegarde jamais restaurée est un espoir, pas une sauvegarde.

## Planifier des exports réguliers (alternative manuelle)

Préférez les sauvegardes distantes intégrées ci-dessus. Pour garder la main complète sur le transport et la destination, un export scripté fonctionne toujours :

- **macOS/Linux (cron).** Un script `curl` hebdomadaire qui envoie une
  phrase secrète en `POST` et dépose le résultat dans un dossier :
  ```sh
  curl -s -o "/mnt/coffre/athena-$(date +%F).enc.json" \
    -b athena_session=… \
    -X POST -H 'Content-Type: application/json' \
    -d '{"passphrase":"…"}' \
    http://home.lan:8000/api/backup/export
  ```
  Le cookie de session vient d'une connexion préalable ; sur le
  bureau (Tauri, `AUTH_MODE=none`) le cookie n'est pas requis. Le
  résultat est déjà chiffré, inutile donc de le ranger en plus dans un
  dossier chiffré comme il l'aurait fallu pour un export JSON en clair.
- **Windows (Planificateur de tâches).** Même idée, avec
  `Invoke-WebRequest` dans un script PowerShell.

## Restaurer (via l'interface)

1. **Sauvegardez d'abord.** Une restauration écrase toutes les données
   de l'utilisateur courant. Faites un export du présent avant.
2. Ouvrez **Réglages → Données → Sauvegarde**, section *Restaurer*.
3. Sélectionnez votre fichier `.json`. Athena :
   - vérifie que la version du format est connue (v1 à v4 aujourd'hui) ;
   - supprime les lignes de l'utilisateur courant (dans une
     transaction) ;
   - réinjecte comptes, catégories, règles, budgets, checkpoints,
     imports et transactions.
4. La page redirige vers le tableau de bord. Vérifiez que les
   soldes, budgets et règles correspondent à ce que vous attendiez.

Le fichier étant portable, la même procédure fonctionne pour
migrer d'un serveur Docker vers l'application bureau (ou l'inverse).

## Que se passe-t-il en cas de fichier PGlite corrompu ?

1. Fermez l'application.
2. Renommez `$DATA_DIR/athena.db` en `athena.db.corrupt` (ne le
   supprimez pas — au cas où).
3. Relancez l'application : Athena crée une base vide et affiche
   l'onboarding.
4. Passez par **Restaurer** avec votre dernier export.

Si vous n'avez pas d'export récent, `athena.db.corrupt` peut parfois
être lu par `sqlite3` ou `pglite` avec `PRAGMA integrity_check` puis
récupéré manuellement — c'est une opération technique, pas
grand-public.

## Pièges fréquents

- **Onglets multiples.** Ne restaurez pas depuis plusieurs onglets en
  même temps — la restauration prend un lock transactionnel, mais
  deux clients qui téléchargent puis renvoient le même fichier
  peuvent produire des doublons de fichiers d'import si l'un termine
  après l'autre.
- **Changement d'utilisateur (Docker).** Sur le serveur familial,
  chaque utilisateur a son propre jeu de données. La restauration
  écrase **uniquement** les lignes de l'utilisateur connecté ; les
  autres membres du foyer ne sont pas touchés. Vérifiez que vous êtes
  bien connecté au bon compte avant de restaurer.
- **Versions de format.** Athena refuse les fichiers dont
  `version` est supérieur à ce qu'il connaît. Rétrogradation ⇒
  échec immédiat, pas de restauration partielle.

## Preuve du bon fonctionnement

Le script `backend/scripts/backup-drill.ts` exécute un aller-retour
sur une base PGlite temporaire (210 transactions, 2 comptes, 8
catégories, 5 règles, 3 budgets, 1 checkpoint), hash l'état avant
export, restaure le fichier téléchargé, puis re-hash. Les deux
empreintes doivent correspondre. Le rapport de la dernière exécution
vit dans [`docs/dev/backup-drill-report.md`](https://github.com/Gekkotron/Athena-Accounting/blob/main/docs/dev/backup-drill-report.md).

## Voir aussi

- [Getting started](./getting-started)
- [Pièces jointes](./attachments) — le canal d'archive dédié aux reçus et factures, et comment le runner planifié ne les re-téléverse que si elles ont changé.
- [Security and privacy](./security-and-privacy)
- [Chiffrement au repos](./encryption-at-rest)
