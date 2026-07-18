---
title: Carte du code
sidebar_position: 3
---

# Carte du code

Une visite guidée du dépôt pour savoir où chercher quoi. Complète la
page d'architecture : l'architecture explique *pourquoi*, cette page
explique *où*.

## Organisation de premier niveau

Le dépôt est un monorepo d'espaces de travail indépendants reliés
par Docker Compose (pour la pile serveur) et Tauri (pour l'application
de bureau). Chaque espace possède son propre `package.json`, son
`tsconfig.json` et sa configuration de tests ; il n'y a pas de
`package.json` à la racine.

| Répertoire     | De quoi il s'agit                                                   |
| -------------- | ------------------------------------------------------------------- |
| `backend/`     | Serveur d'API Fastify + Drizzle (Node/TypeScript).                  |
| `frontend/`    | Single-page app React + Vite servie par nginx en production.        |
| `mcp/`         | Serveur Model Context Protocol optionnel pour un LLM local.         |
| `desktop/`     | Wrapper Tauri qui embarque toute la pile dans une app native.       |
| `website/`     | Site Docusaurus (EN + FR) qui publie `docs/` au build.              |
| `docs/`        | Source de vérité pour les docs utilisateur, contributeur, dev, réf. |
| `.github/`     | Workflows CI, templates d'issues, financement et template de PR.    |

Fichiers racine à connaître : `docker-compose.yml` et
`docker-compose.test.yml` (pile serveur), `install.sh` /
`update.sh` (installation hôte en un coup), `README.md`,
`CONTRIBUTING.md`, et `PLAN.md` (le backlog lisible par machine
piloté par l'Athena Orchestrator — voir `CLAUDE.md` pour son
contrat).

## Visite de `backend/src`

Le backend est découpé en quatre couches plus un fin `lib/` pour les
helpers purs. L'ordre d'import va `entry → http → domain → db` ;
rien de plus bas ne remonte.

- **`db/`** — la couche Drizzle. Toute la persistance vit ici :
  `schema.ts` définit chaque table et enum, `client.ts` ouvre le pool
  Postgres, `migrate.ts` exécute les migrations `drizzle-kit` au
  démarrage, et `server.ts` / `tauri.ts` sont deux bootstraps de
  connexion alternatifs (Postgres géré côté serveur vs embarqué par
  Tauri). Les migrations SQL générées atterrissent dans
  `db/migrations/` (par ex. `0000_init.sql`) — ne les éditez jamais
  à la main. À ouvrir en premier : `backend/src/db/schema.ts`.

- **`domain/`** — logique métier, sans framework. Un dossier par
  contexte borné : `auth/` (utilisateur local, hachage), `imports/`
  (pipelines CSV, OFX, PDF et photo/OCR dans `imports/ocr/`,
  `pdf/`, `photo/`), `reconcile/` (mise en correspondance des
  lignes bancaires avec les écritures attendues), `rules/`
  (auto-catégorisation), `settings/` (magasin clé-valeur chiffré avec
  `crypto.ts`), et `transfers/` (détection des virements internes).
  Aucun import Fastify ou HTTP ici. À ouvrir en premier :
  `backend/src/domain/imports/import-service.ts`.

- **`http/`** — la surface Fastify. `routes/` a un fichier par
  ressource (`accounts.ts`, `budgets.ts`, `reports.ts`,
  `envelopes.ts`, etc.) et `plugins/` héberge le transverse
  (garde d'authentification, métriques). Les fichiers de route
  parsent l'entrée, appellent le code domaine, et façonnent les
  réponses — rien de plus. À ouvrir en premier :
  `backend/src/http/routes/accounts.ts`.

- **`entry/`** — points d'entrée du processus. `backup/` lance les
  sauvegardes planifiées, `mcp/` héberge le serveur MCP embarqué,
  `tips/` sème la table de tips d'onboarding, et `transactions/`
  exécute des batchs ponctuels (backfills, re-catégorisation).
  Chacun est une cible `node` autonome. À ouvrir en premier :
  `backend/src/entry/backup/`.

- **`lib/envelope-math.ts`** — les maths pures derrière les
  enveloppes budgétaires (allocation, report, restant). Gardez-le
  sans framework et sans IO ; il est importé par le domaine comme
  par les tests.

- Fichiers de haut niveau : `buildServer.ts` câble Fastify + plugins
  + routes ; `env.ts` valide les variables d'environnement au boot ;
  `dataDir.ts` résout le dossier de données selon la plateforme
  (serveur LAN vs desktop).

## Visite de `frontend/src`

Le frontend est une SPA React construite avec Vite. L'état vit dans
TanStack Query (état serveur) et dans le contexte React (état UI).
Pas de Redux, pas de store global.

- **`api/`** — clients HTTP typés, un fichier par ressource
  (`accounts.ts`, `imports.ts`, `pdf-templates.ts`, …). `client.ts`
  est le wrapper `fetch` partagé (auth + normalisation d'erreurs) ;
  `types.ts` recopie à la main les DTO du backend (il n'y a pas de
  génération de code entre les deux — maintenez la synchro
  manuellement). `api/demo/` simule toute la surface pour le build
  démo public. À ouvrir en premier :
  `frontend/src/api/client.ts`.

- **`pages/`** — un dossier par route de haut niveau (`Accounts/`,
  `Budgets/`, `Dashboard/`, `Data/`, `Imports/`, `Rules/`,
  `Transactions/`) plus login/profil/paramètres à la racine. Chaque
  dossier de page contient ses écrans, sous-composants, et son
  propre `__tests__/`. À ouvrir en premier :
  `frontend/src/pages/Dashboard/`.

- **`components/`** — widgets réutilisables partagés entre pages :
  graphiques (`CategoryDonut.tsx`, `Sankey.tsx`, `Sparkline.tsx`,
  `BalanceChart/`), layout (`Layout.tsx`, `HubLayout.tsx`,
  `NavIcons.tsx`), tips (`SectionTip.tsx`, `WelcomeTour.tsx`), et
  l'éditeur de templates PDF (`PdfTemplateBuilder/`). À ouvrir en
  premier : `frontend/src/components/Layout.tsx`.

- **`contexts/`** — contextes React pour l'état UI transverse :
  `PrivacyContext.tsx` (flouter les montants) et
  `TipsContext.tsx` (tips déjà rejetés).

- **`lib/`** — petits helpers purs : `format.ts` (devise et dates
  françaises), `normalize.ts`, `label-similarity.ts`,
  `persisted-state.ts`, plus quelques hooks React
  (`useBudgets.ts`, `useEnvelopes.ts`, `useSettings.ts`). Aucun
  composant ici.

- **`i18n/`** et **`locales/`** — configuration de traduction et
  bundles JSON de chaînes (le français est le défaut ; l'anglais
  est présent).

- **`tips/`** — contenu des tips contextuels in-app et la machinerie
  qui décide quand les afficher.

- **`test/`** — configuration Vitest + React Testing Library
  partagée par tous les `__tests__/`.

- `App.tsx` câble le router ; `main.tsx` monte React dans
  `index.html`.

## Visite de `mcp/src`

Le serveur MCP est volontairement minuscule — cinq fichiers, pas de
sous-dossiers :

- **`index.ts`** — point d'entrée du processus ; branche le
  transport stdio.
- **`tools.ts`** — les définitions d'outils Model Context Protocol
  (lister les comptes, requêter les transactions, etc.). C'est le
  fichier à ouvrir en premier : `mcp/src/tools.ts`.
- **`client.ts`** — client HTTP qui rappelle le backend Athena, si
  bien que le serveur MCP est un adaptateur fin, pas une seconde
  source de vérité.
- **`config.ts`** — chargement env + fichier de config.
- **`crypto.ts`** — gestion des jetons pour la session backend.

Les tests vivent dans `mcp/tests/`, pas dans `__tests__/`, faute de
structure par dossier à côté de laquelle les colocaliser.

## Autres répertoires à connaître

- **`desktop/src-tauri/`** — le côté Rust de l'app Tauri
  (`Cargo.toml`, `src/`, `tauri.conf.json`, `capabilities/`,
  `icons/`). **`desktop/sidecar/`** embarque un runtime Node bundlé
  et un `entry.js` pré-construit pour que l'app desktop puisse
  lancer le backend en process sidecar sans Node installé sur le
  système.

- **`website/`** — Docusaurus. `docusaurus.config.ts` est le point
  d'entrée ; `sidebars.ts` contrôle l'arbre de la doc ;
  `i18n/fr/` reflète chaque page anglaise sous
  `docusaurus-plugin-content-docs/current/`. Quand vous éditez
  quoi que ce soit dans `docs/`, reflétez-le dans l'arbre FR dans
  le même commit.

- **`docs/`** — sources Markdown consommées par le site. Divisées
  en `users/`, `contributors/` (vous êtes ici), `dev/`,
  `reference/`, `superpowers/`, et `RELEASES/`.

- **`.github/`** — `workflows/` contient chaque pipeline CI (lint,
  test, build, release) ; `ISSUE_TEMPLATE/` et
  `PULL_REQUEST_TEMPLATE.md` définissent la surface de
  contribution ; `FUNDING.yml` pointe vers GitHub Sponsors.

## Conventions partagées

- **Pas d'alias de chemins `tsconfig`.** `backend/tsconfig.json` et
  `frontend/tsconfig.json` utilisent tous deux des imports
  relatifs simples (`../../db/schema`). Nous avons choisi la
  lisibilité des résultats de grep plutôt que des imports courts ;
  n'ajoutez pas de mappings `paths`.

- **Les tests sont colocalisés dans `__tests__/`.** Pour chaque
  dossier source qui a des tests, il existe un `__tests__/` voisin
  contenant `<nom>.test.ts` (ou `.test.tsx` pour React). Vitest est
  le runner dans les deux espaces ; Playwright pilote les suites
  end-to-end de `frontend/e2e/`.

- **Le code généré atterrit à des endroits prévisibles, jamais
  comme fichiers édités à la main dans `src/`.** Les migrations SQL
  Drizzle vivent dans `backend/src/db/migrations/` et sont produites
  par `drizzle-kit generate` à partir de `schema.ts` — commitez le
  changement de schéma et le `.sql` généré ensemble. Les types de
  DTO frontend/backend ne sont *pas* générés :
  `frontend/src/api/types.ts` recopie les réponses backend à la
  main, et il n'y a pas de client OpenAPI. Tauri génère
  `desktop/src-tauri/gen/` au build ; ne commitez pas de changements
  là-dedans.

- **Décimales françaises.** Toute UI qui lit un montant utilise
  `<input type="text" inputMode="decimal">` et `parseDecimal` de
  `lib/format.ts`, jamais `<input type="number">`. Voir
  `frontend/src/lib/format.ts` pour le helper.

- **Les contextes bornés restent bornés.** Les dossiers `domain/`
  du backend ne s'importent pas entre eux ; si deux contextes
  partagent réellement de la logique, promouvez le helper dans
  `backend/src/lib/`.

*Voir aussi :* [Architecture](architecture.md) ·
[Développement](development.md)

← [Retour aux docs contributeurs](README.md)
