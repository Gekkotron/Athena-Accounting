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

:::caution Limite connue
Les fichiers d'export sont du **JSON en clair, sans chiffrement au
repos**. Ils contiennent l'intégralité de vos comptes, transactions,
règles et budgets. Conservez-les dans un dossier chiffré (FileVault,
BitLocker, LUKS, Cryptomator, etc.) ou dans un stockage protégé par
mot de passe si vous les gardez hors de la machine d'origine.
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
2. Cliquez sur **Exporter les données**. Athena télécharge un fichier
   `athena-backup-YYYY-MM-DD-HHMMSS.json`.
3. Rangez le fichier dans un stockage chiffré (voir la limite
   ci-dessus).

Il n'y a rien à configurer côté serveur : l'export est un simple
`GET /api/backup/export` qui sérialise votre utilisateur avec toutes
ses relations, en clés naturelles (noms de comptes, noms de
catégories), donc lisible même en dehors d'Athena.

## Planifier des exports réguliers

Athena ne planifie pas d'export automatique — c'est volontaire, pour
éviter que le fichier ne se retrouve à un endroit sur lequel vous
n'avez pas la main. Deux approches courantes :

- **macOS/Linux (cron).** Un script `curl` hebdomadaire qui appelle
  l'endpoint et déplace le résultat dans un dossier chiffré :
  ```sh
  curl -s -o "/mnt/coffre/athena-$(date +%F).json" \
    -b athena_session=… \
    http://home.lan:8000/api/backup/export
  ```
  Le cookie de session vient d'une connexion préalable ; sur le
  bureau (Tauri, `AUTH_MODE=none`) le cookie n'est pas requis.
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
- [Security and privacy](./security-and-privacy)
