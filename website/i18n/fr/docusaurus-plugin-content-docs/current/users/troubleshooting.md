---
title: Dépannage
sidebar_position: 9
---

# Dépannage

Problèmes courants et contournements. Chaque sous-section suit la même
structure : ce que vous observez, la cause, et la correction. Si le
vôtre n'apparaît pas, ouvrez une issue en précisant votre version
d'Athena, le plus petit exemple qui reproduit le problème, et les
lignes utiles de `docker compose logs` (voir
[Recueillir des diagnostics](#recueillir-des-diagnostics)).

## Démarrage

### Le port Postgres 5432 est déjà utilisé

**Symptôme.** `docker compose up` échoue avec
`bind: address already in use` sur le port `5432`, ou le service `db`
redémarre en boucle.

**Cause.** Un autre processus de l'hôte écoute déjà sur `5432` — le
plus souvent un Postgres installé via Homebrew, `postgresql.service`,
ou une autre stack compose.

**Correction.** Soit arrêter l'autre processus (`brew services stop
postgresql`, `systemctl stop postgresql`), soit supprimer complètement
le mapping de port côté hôte — le backend parle à Postgres via le
réseau compose et n'a pas besoin que `5432` soit exposé sur l'hôte.
Commentez le bloc `ports:` du service `db` dans `docker-compose.yml` ;
la stack fonctionne toujours, seul l'usage de `psql` depuis la machine
hôte cesse de fonctionner.

### Fichier `.env` manquant ou incomplet

**Symptôme.** `docker compose up` échoue avec
`error while interpolating POSTGRES_USER`, ou le conteneur backend
plante au démarrage sur `SESSION_SECRET is required`.

**Cause.** Le fichier compose lit les secrets depuis `.env` à la
racine du dépôt. Si vous avez cloné le projet sans copier
`.env.example` en `.env`, aucune variable n'est définie.

**Correction.**

```sh
cp .env.example .env
# puis éditez .env et définissez au minimum :
#   POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, SESSION_SECRET
```

`SESSION_SECRET` doit être une longue chaîne aléatoire — générez-la
avec `openssl rand -hex 32`. Redémarrez la stack :
`docker compose down && docker compose up -d`.

### Échec de migration au premier démarrage

**Symptôme.** Le conteneur `backend` s'arrête peu après que `db`
devient healthy. `docker compose logs backend` affiche une erreur de
migration Prisma ou Drizzle — typiquement
`relation "…" already exists` ou `column "…" does not exist`.

**Cause.** Le volume `postgres-data/` provient d'un schéma antérieur
incompatible (mise à jour d'Athena à travers une migration cassante,
ou base peuplée à la main).

**Correction.** Pour une installation fraîche, supprimez le volume
obsolète :

```sh
docker compose down
rm -rf ./postgres-data
docker compose up -d
```

Pour une installation existante, **ne supprimez pas le volume** —
exportez d'abord vos données (voir
[Sauvegarde et restauration](./backup-recovery)), puis effacez et
restaurez.

## Import

### Le modèle PDF ne matche plus

**Symptôme.** Un relevé qui s'importait bien le mois dernier renvoie
maintenant « 0 transaction extraite » ou « le modèle ne correspond
pas ».

**Cause.** Votre banque a modifié la mise en page de ses PDF — même un
décalage d'un pixel sur une colonne ou un en-tête renommé casse
l'extracteur à base de regex. C'est de loin l'échec d'import le plus
fréquent.

**Correction.** Ouvrez **Réglages → Import → Modèles**, choisissez le
modèle du compte concerné, et relancez « auto-détecter depuis un
échantillon » avec le nouveau PDF. Si la mise en page a peu changé,
éditer les ancres de colonnes à la main est en général plus rapide
que de repartir de zéro. Voir [Importer](./importing) pour une
procédure guidée.

### Le fichier OFX s'importe en charabia

**Symptôme.** Les transactions arrivent, mais les libellés sont pleins
de `?` ou les caractères accentués sont mal décodés (`Ã©` au lieu
de `é`).

**Cause.** Les banques françaises et belges produisent souvent des OFX
en `ISO-8859-1` (ou `windows-1252`), alors que l'en-tête OFX 1.x
déclare `UTF-8` — ou ne déclare rien du tout. Athena lit en UTF-8 par
défaut et retombe sur Latin-1 quand il détecte des séquences UTF-8
invalides, mais un fichier à encodage mixte peut passer entre les
mailles.

**Correction.** Réencodez le fichier avant l'import :

```sh
iconv -f WINDOWS-1252 -t UTF-8 releve.ofx > releve-utf8.ofx
```

Puis ré-importez `releve-utf8.ofx`. Si votre banque produit
systématiquement des fichiers en Latin-1, marquez le compte dans
**Réglages → Import → Avancé** pour forcer le décodage
`windows-1252` sur chaque import de cette source.

### Les colonnes CSV ne correspondent pas

**Symptôme.** L'assistant d'import CSV propose un mapping incorrect
(la date dans le champ montant, ou toute la ligne sur une seule
colonne).

**Cause.** Deux variantes fréquentes : le fichier utilise `;` comme
séparateur (export banque française) alors qu'Athena a deviné `,`, ou
il comporte une ligne d'en-tête en prose au-dessus des vrais titres de
colonnes.

**Correction.** Dans l'assistant, changez explicitement le séparateur
(`;`, `,`, `\t`) et réglez « Ligne d'en-tête » sur le bon numéro de
ligne. Enregistrez ce mapping comme modèle sur le compte pour que
l'import suivant depuis la même banque le détecte automatiquement. Si
le fichier est fondamentalement mal formé (séparateurs mélangés,
virgules non échappées dans les libellés), ouvrez-le dans un éditeur
de texte et nettoyez-le avant import — Athena ne fera pas de
supposition silencieuse dans ce cas.

## Écart de solde

Vous avez rapproché le mois dernier, et ce mois-ci le solde calculé
ne correspond plus au solde officiel de la banque. Trois causes
expliquent presque tous les écarts.

### Une transaction manque

**Symptôme.** Le solde Athena est inférieur (ou supérieur) au solde
banque d'exactement le montant d'une transaction.

**Cause.** Un relevé couvrait une période partielle, et une
transaction se trouvait à la frontière de deux fichiers — soit pas
importée du tout, soit importée deux fois avec un seul des deux
doublons supprimé lors de la déduplication.

**Correction.** Filtrez le compte sur la plage de dates litigieuse et
comparez ligne à ligne avec le PDF du relevé. Ajoutez la ligne
manquante via **+ Nouvelle transaction**, ou supprimez le doublon.
Relancez ensuite **Réglages → Solde → Vérifier** pour confirmer que
les deux chiffres coïncident.

### Un doublon n'a pas été fusionné

**Symptôme.** La même transaction apparaît deux fois, une fois depuis
un import OFX et une fois depuis un import PDF (ou une fois depuis
chacun de deux relevés qui se chevauchent).

**Cause.** La déduplication compare date, montant et libellé
normalisé. Si les deux sources produisent des libellés légèrement
différents (par exemple `CB CARREFOUR 12/03` vs `PAIEMENT CARTE
CARREFOUR`), l'empreinte ne correspond pas et le second exemplaire
est conservé.

**Correction.** Ouvrez **Transactions**, triez par date, repérez la
paire, et supprimez celle qui vient de la source la moins fiable
(en général le PDF — les libellés OFX sont plus consistants). Pour
éviter la récidive, ajoutez une règle de normalisation dans
**Réglages → Règles** qui réécrit les deux libellés vers la même
forme canonique avant la déduplication.

### Dérive de checkpoint

**Symptôme.** L'écart est faible (quelques euros ou centimes) et
présent depuis une date bien précise.

**Cause.** Un **checkpoint** — l'ancre « au JJ/MM/AAAA, la banque
indique un solde de X » qu'Athena utilise comme source de vérité — a
été saisi avec la mauvaise valeur, ou des transactions antérieures
ont été modifiées après sa création. Chaque solde affiché vaut
`checkpoint + somme des transactions postérieures au checkpoint` ;
un checkpoint erroné décale donc tout ce qui vient après.

**Correction.** Ouvrez **Réglages → Compte → Checkpoints**, supprimez
le checkpoint dérivé, et re-saisissez-le avec la valeur d'un relevé
banque dont la date vous inspire confiance. Si plusieurs checkpoints
sont faux, ne gardez que le plus ancien correct — Athena recalcule à
partir de là.

## Erreurs de sauvegarde et de restauration

### « Version de sauvegarde non supportée »

**Symptôme.** La restauration échoue immédiatement avec
`unsupported backup version: v5 (this build supports up to v4)`.

**Cause.** L'export a été produit par une version d'Athena plus
récente que celle sur laquelle vous restaurez. Athena refuse d'ouvrir
un fichier de version supérieure — rétrograder un schéma n'est pas
sûr, c'est un refus volontaire.

**Correction.** Mettez à jour l'installation cible (`git pull &&
docker compose up -d --build`, ou mise à jour de l'application
bureau) jusqu'à atteindre la version qui a produit le fichier.
Relancez ensuite la restauration.

### La restauration se bloque puis fait un rollback

**Symptôme.** La restauration tourne pendant une minute, puis l'UI
affiche « restauration échouée, aucune donnée modifiée ».
`docker compose logs backend` montre un rollback de transaction.

**Cause.** La restauration prend un lock transactionnel sur les
lignes de l'utilisateur courant. Un second client (un autre onglet,
ou un import en cours en arrière-plan) détient un lock au niveau
ligne et la restauration expire en attendant.

**Correction.** Fermez tous les autres onglets Athena et annulez
l'import en cours, puis réessayez. La restauration est idempotente —
la tentative échouée n'a laissé aucun état partiel, grâce au rollback.

### `athena.db` est corrompu (application bureau)

**Symptôme.** L'application bureau plante au lancement avec
`PGlite: database is malformed`, ou l'UI s'ouvre sur un état vide
alors que vous aviez déjà importé des données.

**Cause.** Le fichier PGlite a été écrit pendant que le système
s'arrêtait, ou un antivirus l'a mis en quarantaine en cours
d'écriture.

**Correction.** Renommez le fichier plutôt que de le supprimer :

```sh
# macOS
mv "~/Library/Application Support/Athena Accounting/athena.db" \
   "~/Library/Application Support/Athena Accounting/athena.db.corrupt"
```

Relancez l'application, passez par l'onboarding, puis utilisez
**Réglages → Données → Restaurer** avec votre dernier export.
Conservez le fichier `.corrupt` jusqu'à avoir vérifié la
restauration — c'est votre source de récupération de dernier recours.

## Recueillir des diagnostics

Avant d'ouvrir une issue, rassemblez ces trois éléments — ils
résolvent la plupart des tickets dès le premier échange.

### Logs des conteneurs (installation Docker)

```sh
docker compose logs --tail=200 backend
docker compose logs --tail=200 db
```

Les 200 dernières lignes suffisent en général. Si le problème est au
démarrage, ajoutez `--since 5m` pour couvrir une fenêtre complète.
Masquez toute ligne qui contient `SESSION_SECRET`, `DATABASE_URL` ou
la valeur d'un cookie avant de coller.

### Endpoint `/health`

```sh
curl -s http://localhost:8001/health
```

Renvoie `{ "status": "ok", "db": "ok" }` quand tout est câblé.
`{ "db": "down" }` restreint le problème à Postgres ; une erreur de
connexion le restreint au backend ou à son binding de port. Le port
backend par défaut est `8001` — modifiez-le si vous avez fixé
`BACKEND_PORT` dans `.env`.

### Endpoint `/metrics`

```sh
curl -s http://localhost:8001/metrics
```

Expose les compteurs et histogrammes au format Prometheus. Les deux
lignes utiles à grepper quand quelque chose paraît lent sont
`http_request_duration_seconds` (latence par route) et
`athena_imports_failed_total` (échecs d'import par motif). Joignez un
extrait de la sortie à votre issue si vous rapportez une régression
de performance.

*Voir aussi :* [Importer](./importing) ·
[Démarrage](./getting-started) ·
[Sauvegarde et restauration](./backup-recovery)

← [Retour aux docs utilisateur](README.md)
