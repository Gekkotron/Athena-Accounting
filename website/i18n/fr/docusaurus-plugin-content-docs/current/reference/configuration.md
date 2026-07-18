---
title: Configuration
sidebar_position: 2
---

# Configuration

Athena lit sa configuration depuis les variables d'environnement au démarrage
et depuis les réglages par utilisateur stockés en base. Cette page énumère
les deux, ainsi que les ports réseau par défaut sur lesquels les trois
services écoutent.

## Variables d'environnement

Les valeurs par défaut ci-dessous sont celles utilisées quand la variable
n'est pas définie. Copiez `.env.example` en `.env` avant de lancer
`docker compose up` et renseignez les champs marqués **requis**.

### PostgreSQL (service `db`)

| Variable | Défaut | Effet |
| --- | --- | --- |
| `POSTGRES_USER` | `athena` (à remplacer) | **Requis.** Rôle de base utilisé par le backend. Consommé aussi par l'image Postgres au premier boot. |
| `POSTGRES_PASSWORD` | *(aucun)* | **Requis.** Mot de passe du rôle `POSTGRES_USER`. Ne laissez jamais la valeur placeholder en production. |
| `POSTGRES_DB` | `athena` | Nom de la base créée au premier démarrage. |

### Backend (service `backend`)

| Variable | Défaut | Valeurs | Effet |
| --- | --- | --- | --- |
| `SESSION_SECRET` | *(aucun)* | ≥ 32 caractères | **Requis.** Signe le cookie de session et dérive la clé de chiffrement des payloads MCP. À générer avec `openssl rand -hex 32`. La modifier invalide toutes les sessions et tous les endpoints MCP chiffrés. |
| `DATABASE_URL` | *(aucun)* | URL Postgres | **Requise quand `DB_DRIVER=postgres`.** URL complète, ex. `postgres://athena:…@db:5432/athena`. |
| `COOKIE_SECURE` | `false` | `true` / `false` / `1` / `0` | Marque le cookie de session comme `Secure`. À laisser sur `false` en déploiement LAN HTTP simple — sinon le navigateur rejette le cookie et la connexion échoue silencieusement. À passer à `true` derrière un reverse proxy HTTPS. |
| `NODE_ENV` | `development` | `development` / `production` / `test` | Contrôle le format des logs Fastify (`pino-pretty` en dev, JSON sinon) et active le serveur de fichiers statiques intégré quand `SERVE_STATIC` n'est pas défini. Docker Compose fixe cette variable à `production`. |
| `PORT` | `3000` | entier | Port sur lequel Fastify écoute dans le conteneur. Docker Compose mappe `BACKEND_PORT` sur l'hôte vers ce port. |
| `DB_DRIVER` | `postgres` | `postgres` / `pglite` | Sélectionne le backend SQL. `postgres` utilise `pg.Pool` (parcours Docker). `pglite` utilise Postgres embarqué en WASM (Tauri desktop, tests). |
| `PGLITE_PATH` | *(non défini — en mémoire)* | chemin fichier | Utilisé uniquement quand `DB_DRIVER=pglite`. Définie, PGlite persiste dans ce répertoire ; non définie, base éphémère en mémoire. |
| `AUTH_MODE` | `session` | `session` / `none` | `session` est le parcours LAN/Docker : cookies + mots de passe argon2id, inscription via l'onboarding. `none` désactive complètement l'authentification — chaque requête est authentifiée comme un unique utilisateur local codé en dur. **Ne jamais activer `none` sur un déploiement qui n'est pas strictement en loopback.** |
| `SERVE_STATIC` | *(non défini — suit `NODE_ENV=production`)* | `true` / `false` / `1` / `0` | Si vrai, Fastify sert aussi le frontend compilé depuis `STATIC_ROOT`. Utilisé par le sidecar Tauri ; Docker Compose garde nginx en frontal. |
| `STATIC_ROOT` | `<cwd>/frontend/dist` | chemin fichier | Répertoire depuis lequel Fastify sert le SPA quand `SERVE_STATIC` est actif. |
| `DATA_DIR` | `/data` (Docker) / CWD (dev) | chemin fichier | Répertoire racine des données utilisateur : fichier PGlite, sauvegardes, imports. Le point d'entrée Tauri le remplace par le dossier de données utilisateur spécifique à l'OS. |
| `OCR_LANG_PATH` | *(non défini — fetch CDN)* | chemin fichier | Chemin local vers les fichiers de langue Tesseract. Non défini, le premier OCR télécharge depuis un CDN — ce qui échoue en déploiement LAN sans internet. Les builds Docker embarquent les fichiers et fixent la variable automatiquement. |

### Frontend (build-time, Vite)

Le frontend est un bundle statique — ces variables sont lues au moment du
`npm run build` par Vite et inlinées dans le `dist/` produit, pas lues à
l'exécution.

| Variable | Défaut | Effet |
| --- | --- | --- |
| `VITE_DEMO` | *(non défini)* | Quand elle vaut `1`, `npm run build` produit `frontend/dist-demo/` au lieu de `frontend/dist/`. Le bundle route chaque appel API vers un adaptateur navigateur alimenté par un jeu de données seed — aucun backend requis. Utilisé pour publier la démo publique GitHub Pages. |

### Ports hôte (overrides Compose)

| Variable | Défaut | Effet |
| --- | --- | --- |
| `FRONTEND_PORT` | `8000` | Port hôte mappé sur le port 80 du conteneur frontend. Bindé sur `0.0.0.0` pour que les autres appareils du LAN atteignent l'application. |
| `BACKEND_PORT` | `8001` | Port hôte mappé sur le port 3000 du conteneur backend. Bindé sur `0.0.0.0` pour les tests API directs ; le frontend proxifie les appels `/api/*` via nginx en production. |

Évitez `6000`, `6666`, `6665–6669` et `6697` — Chrome les bloque avec
`ERR_UNSAFE_PORT`.

## Ports réseau par défaut

| Service | Port hôte | Port conteneur | Bind |
| --- | --- | --- | --- |
| Frontend (nginx) | `${FRONTEND_PORT:-8000}` | `80` | `0.0.0.0` (accessible LAN) |
| Backend (Fastify) | `${BACKEND_PORT:-8001}` | `3000` | `0.0.0.0` (accessible LAN) |
| PostgreSQL | `5432` | `5432` | `127.0.0.1` uniquement (jamais sur le LAN) |

Commentez le bloc `ports:` du service `db` dans `docker-compose.yml` si vous
n'avez pas besoin de joindre Postgres depuis l'hôte — le backend le
contacte par le réseau Compose de toute façon.

## Réglages par utilisateur (page Réglages)

Ces valeurs sont persistées dans la colonne JSON `users.settings` et se
modifient depuis la page Réglages. Elles sont par utilisateur, pas par
installation. Le backend écrit les valeurs par défaut à la première
sauvegarde ; le frontend affiche les mêmes valeurs par défaut le temps que
le premier fetch aboutisse (source : `frontend/src/lib/settings.ts`).

| Réglage | Défaut | Valeurs | Effet |
| --- | --- | --- | --- |
| Période par défaut (`dashboardRange`) | `3m` | `30d`, `3m`, `6m`, `12m`, `all` | Fenêtre temporelle sur laquelle le tableau de bord s'ouvre à chaque chargement. Le sélecteur de période reste modifiable au sein d'une session. |
| Compte du graphique par défaut (`dashboardChartScope`) | `all` | `all` ou un id de compte | Compte(s) sur lesquels portent les graphiques du tableau de bord au chargement. `all` agrège tous les comptes. |
| Seuil de ligne pointillée (`chartGapThresholdDays`) | `6` | entier positif (jours) | Sur la courbe du solde, un écart entre deux points supérieur à ce seuil est tracé en pointillés — indice visuel qu'il manque peut-être des données (période sans import par exemple). |
| Seuil de similarité par défaut (`duplicateSimilarityThreshold`) | `0` | entier 0–100 | Filtre par défaut sur la liste « Possibles doublons » de Données → Doublons. Les groupes dont la similarité de libellés est inférieure au seuil sont masqués. `0` affiche tous les groupes candidats. |

*Voir aussi :* [Démarrage](/docs/users/getting-started) ·
[Sécurité et confidentialité](/docs/users/security-and-privacy)

← [Retour à l'index de la référence](README.md)
