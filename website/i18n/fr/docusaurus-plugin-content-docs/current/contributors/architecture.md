---
title: Architecture
sidebar_position: 2
---

# Architecture

## Le système en une phrase

Athena est une pile à trois conteneurs — un frontend React, un backend
Fastify et une base PostgreSQL — orchestrée par Docker Compose et conçue
pour tourner sur une seule machine. Un quatrième conteneur optionnel
héberge un serveur Model Context Protocol pour l'accès local aux LLM.

## Schéma

```
                    ┌─────────────────────────────────────┐
                    │  Navigateur  (127.0.0.1:8000)       │
                    │  React 18 + Vite + TanStack Query   │
                    └────────────────┬────────────────────┘
                                     │  HTTP
                                     ▼
                    ┌─────────────────────────────────────┐
                    │  Conteneur frontend                 │
                    │  nginx sert les assets Vite         │
                    │  (proxy /api → backend:3000)        │
                    └────────────────┬────────────────────┘
                                     │  HTTP
                                     ▼
                    ┌─────────────────────────────────────┐
                    │  Conteneur backend                  │
                    │  Node 20 + Fastify 5 + TypeScript   │
                    │  Drizzle ORM · argon2id · pg driver │
                    │  Port hôte 8001 → conteneur 3000    │
                    └────────────────┬────────────────────┘
                                     │  SQL
                                     ▼
                    ┌─────────────────────────────────────┐
                    │  Conteneur PostgreSQL 16            │
                    │  pg_trgm · unaccent · pgcrypto      │
                    │  Port hôte 5432 lié à 127.0.0.1     │
                    └─────────────────────────────────────┘

                    ┌─────────────────────────────────────┐
                    │  Conteneur MCP (optionnel)          │
                    │  Chiffrement de bout en bout via    │
                    │  un jeton par utilisateur ; parle   │
                    │  au backend.                        │
                    └─────────────────────────────────────┘
```

## Découpage des services

| Conteneur | Runtime | Port hôte | Port conteneur | Responsabilité |
|-----------|---------|-----------|----------------|----------------|
| `frontend` | nginx | `8000` | `80` | Sert l'application React compilée ; proxie `/api/*` vers le backend. |
| `backend` | Node 20 | `8001` | `3000` | Logique métier, auth, importeurs, catégorisation, agrégats. |
| `postgres` | PostgreSQL 16 | `5432` (loopback) | `5432` | Persistance. Utilise `pg_trgm`, `unaccent`, `pgcrypto`. |
| `mcp` (optionnel) | Node 20 | non exposé | — | Surface d'outils LLM. Chiffre les payloads avec un jeton par utilisateur. |

Le frontend et le backend écoutent sur toutes les interfaces hôtes pour
que d'autres appareils du LAN puissent joindre l'application. Postgres
n'écoute que sur `127.0.0.1` — le backend l'atteint via le réseau
Compose, et rien en dehors de l'hôte ne doit y toucher.

## Flux d'une requête : « l'utilisateur importe un fichier OFX »

Suivre une opération de bout en bout permet de rendre les couches
concrètes.

1. **Navigateur** — l'utilisateur dépose `bnp_2026-06.ofx` sur la page
   Imports. Le frontend fait un `POST` du fichier sur `/api/imports`.
2. **Proxy frontend** — nginx transmet la requête au conteneur backend
   à `http://backend:3000/api/imports`.
3. **Plugin d'auth backend** — vérifie le cookie de session
   (`backend/src/http/plugins/auth.ts`), fait tourner l'identifiant
   de session à la connexion (pas à chaque requête) et attache l'id
   utilisateur à la requête.
4. **Route d'import backend** — lit le fichier, détecte l'encodage,
   identifie le format (OFX dans ce cas) et délègue au parseur OFX
   dans `backend/src/domain/imports/`.
5. **Parseur OFX** — produit un flux de transactions candidates avec
   des libellés normalisés (sans accents, en casse pliée pour la
   recherche plein texte).
6. **Passe de catégorisation** — chaque candidat traverse le jeu de
   règles de l'utilisateur (`backend/src/domain/rules/`). Les
   correspondances reçoivent un `category_id` ; les autres restent
   `NULL` et atterrissent dans l'onglet Tri.
7. **Déduplication + insertion** — le backend calcule une signature
   de contenu pour chaque candidat et demande à Postgres d'insérer
   avec une clause `ON CONFLICT` sur la signature. Les nouvelles
   lignes sont créées ; les doublons incrémentent le compteur
   « lu mais dédupliqué ».
8. **Ligne d'audit** — une ligne `imports` enregistre le hash du
   fichier, le nombre de lignes insérées / ignorées / en erreur, et
   l'horodatage. Réimporter le même fichier est un no-op.
9. **Réponse** — le backend répond avec le résumé par fichier ; le
   frontend l'affiche sous la zone de dépôt.

Pour les PDF, l'étape 5 est remplacée par le flux de l'assistant de
modèle (voir la page utilisateur [Import](/docs/users/importing)) ;
tout le reste est identique.

## Bibliothèques clés

- **Fastify 5** — framework HTTP. Choisi pour sa validation des routes
  par schéma et sa faible surcharge.
- **Drizzle ORM** — SQL typé. Le schéma vit dans
  `backend/src/db/schema.ts` et sert aussi de source de types pour les
  réponses d'API.
- **TanStack Query** — état serveur côté frontend. Chaque appel API
  est un `useQuery` ou un `useMutation` ; la mise en cache et le
  refetch en arrière-plan sont gérés par la bibliothèque.
- **Tailwind 3** — CSS utilitaire. Pas de librairie de composants ;
  le design system vit dans `frontend/src/components/`.
- **Extensions PostgreSQL :**
  - `pg_trgm` — index trigrammes pour la recherche plein texte.
  - `unaccent` — pliage des accents à l'exécution des requêtes.
  - `pgcrypto` — secrets aléatoires et chiffrement des payloads MCP.
- **`argon2` (mode argon2id)** — hachage des mots de passe. Sel par
  utilisateur, paramètres OWASP 2024 (19 MiB de mémoire, 2 itérations,
  parallélisme 1).
- **Migrations SQL manuelles** — fichiers dans
  `backend/src/db/migrations/`, appliqués dans l'ordre lexicographique
  au démarrage du serveur, suivis dans une table `schema_migrations`.
  Chaque fichier tourne dans sa propre transaction.

## Observabilité

Le backend expose des métriques Prometheus sur `GET /metrics` sur le
même port que l'API — sans auth (LAN uniquement), limité à 20 requêtes
par minute par IP client. Voir la section *Metrics* du README de
premier niveau pour les labels et la config de scrape canonique.

## Pour aller plus loin

- **[Carte du code](code-map.md)** — où les choses vivent dans l'arbre.
- **[Développement](development.md)** — comment faire tourner la pile
  localement et où sont les tests.
- **[Base de données](database.md)** — points saillants du schéma et
  flux des migrations.

← [Retour aux docs contributeurs](README.md)
