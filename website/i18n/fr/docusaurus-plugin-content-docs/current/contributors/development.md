---
title: Développement
sidebar_position: 5
---

# Développement

Comment faire tourner Athena localement, lancer les tests et proposer
un changement. Cette page suppose que Docker est installé — et, en
option pour une meilleure boucle de dev, Node 20.

## Installation locale

Clonez et générez les secrets :

```bash
git clone https://github.com/Gekkotron/Athena-Accounting.git
cd Athena-Accounting
./install.sh
```

`install.sh` écrit un fichier `.env` avec des secrets aléatoires
robustes. Modifiez-le si vous voulez changer les ports ou les
identifiants de la base ; les valeurs par défaut conviennent pour du
dev local.

Démarrez la pile :

```bash
docker compose up --build
```

Le premier build est lent (installation de Node + extensions Postgres).
Les démarrages suivants sont rapides. Ouvrez
[http://127.0.0.1:8000](http://127.0.0.1:8000).

## Faire tourner l'application en mode dev

`docker compose up` utilise la build de production du frontend. Pour
du travail actif côté frontend avec HMR, vous voudrez lancer le serveur
de dev Vite directement :

```bash
cd frontend
npm install
npm run dev
```

Le backend continue de tourner dans Docker ; le serveur de dev Vite
proxie `/api` vers `http://127.0.0.1:8001` (voir
`frontend/vite.config.ts`).

## Lancer les tests

Les tests backend sont scindés en deux niveaux.

### Tests unitaires et de routes (sans base de données)

La majorité des tests backend tournent sans base :

```bash
cd backend
npm install
npm test
```

Les tests qui dépendent de la base sont marqués
`describe.skipIf(!RUN_DB_TESTS)` et s'afficheront comme *skipped* dans
cette exécution — c'est normal.

### Tests d'intégration dépendants de la base

Les tests de routes / d'intégration ont besoin d'un vrai Postgres. Ils
sont conditionnés par la variable d'environnement `RUN_DB_TESTS=1`.

> **⚠️ Vous ne pouvez pas les pointer sur votre vraie base.**
> Ces tests réinitialisent l'état par des suppressions de tables
> entières sans condition (`db.delete(transactions)`,
> `db.delete(accounts)`, `db.delete(users)`, …) sur la
> `DATABASE_URL` qui leur est fournie. Les pointer sur votre vraie
> base l'effacerait. Ils supposent aussi une base fraîche, vide et
> migrée (l'onboarding ne réussit que quand aucun utilisateur
> n'existe).

La manière sûre de les lancer est le script d'enveloppe, qui monte un
`postgres:16-alpine` jetable sur tmpfs, applique les migrations, lance
la suite avec `RUN_DB_TESTS=1`, puis démonte tout :

```bash
bash backend/scripts/test-db.sh
```

Passez des arguments tels quels :

```bash
bash backend/scripts/test-db.sh tests/transactions-route.test.ts   # un fichier
bash backend/scripts/test-db.sh -t "running balance"               # par nom de test
```

Passez `KEEP_TEST_DB=1` pour laisser la pile en place et déboguer (le
script indique comment la démonter).

Sans le wrapper, l'équivalent est :

```bash
docker compose -f docker-compose.test.yml run --rm --build backend-test
docker compose -f docker-compose.test.yml down -v
```

Sur une machine de dev avec npm, `cd backend && npm run test:db`
appelle le même script.

### Comment ça marche

- `docker-compose.test.yml` définit deux services jetables : `test-db`
  (Postgres éphémère) et `backend-test`.
- `backend-test` construit l'étape `test` de `backend/Dockerfile`
  (étape de build + fichiers de test). Son entrypoint
  (`backend/scripts/docker-test-entrypoint.sh`) applique les migrations,
  puis exécute `vitest run`.
- Tout est isolé dans son propre projet Compose avec des identifiants
  réservés aux tests — impossible de rentrer en collision avec la
  vraie pile.

### Lien avec la CI

`.github/workflows/ci.yml` fait la même chose (Postgres jetable →
migration → exécution des tests avec `RUN_DB_TESTS=1`) ; c'est donc
l'équivalent local d'une exécution CI de la base.

## Vérification de types et linting

```bash
cd backend
npm run typecheck
```

```bash
cd frontend
npm run typecheck
npm run lint
```

Les deux doivent passer avant tout commit.

## Conventions de commit et de PR

- Un changement logique par commit. Si votre changement touche
  plusieurs préoccupations, découpez-le.
- Les messages de commit suivent `type(scope): résumé` où `type` est
  `feat`, `fix`, `refactor`, `docs`, `test` ou `chore`.
- Les pull requests doivent expliquer le *pourquoi*, pas seulement le
  *quoi*. Le diff couvre le *quoi*.
- La CI doit être verte avant de merger.

## Pour aller plus loin

- **[Architecture](architecture.md)** — comment les pièces s'imbriquent.
- **[Carte du code](code-map.md)** — où les choses vivent.
- **[Base de données](database.md)** — schéma et migrations.

← [Retour aux docs contributeurs](README.md)
