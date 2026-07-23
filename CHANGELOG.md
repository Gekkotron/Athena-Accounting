# Changelog

Toutes les versions notables d'Athena Accounting sont listées ici.

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) ;
le projet suit [SemVer](https://semver.org/lang/fr/) — `MAJOR.MINOR.PATCH`.

Chaque section porte la version et la date au format `YYYY-MM-DD`.
Le workflow `.github/workflows/release.yml` extrait la section
correspondant au tag `vX.Y.Z` et la publie comme corps de la release
GitHub — garder ce format exact (`## [X.Y.Z] - YYYY-MM-DD`).

## [Unreleased]

### Added
- Publication d'une release GitHub à partir d'un tag `vX.Y.Z`
  (`.github/workflows/release.yml`), avec extraction automatique
  des notes depuis ce fichier.

### Fixed
- Tests backend en CI : sérialisation des fichiers de test
  (`fileParallelism: false`) — les fichiers partagent la même base
  Postgres et plusieurs faisaient des `db.delete(users|accounts)`
  globaux, ce qui effaçait les fixtures des autres fichiers en
  parallèle et cassait ~65 tests avec des violations FK.

## [1.0.0-desktop-rc1] - 2026-07-23

Second desktop pre-release après `v1.0.0-desktop-beta1`. Voir
`docs/RELEASES/v1.0.0-desktop-rc1.md` pour la liste complète.

### Security
- Conteneur non-root + headers de sécurité nginx.
- Option `/metrics` avec bearer-token pour Prometheus sur LAN.
- Rejet des patterns regex à risque ReDoS à la création d'une règle.
- Scoping par `userId` sur les endpoints Rules (IDOR).

### Fixed
- Corrections comptables : atomicité `transaction + splits`,
  `unlink + delete` transactionnels, `envelopes.bumpBy` race-safe,
  timeseries clippée à la période demandée, merge de comptes refusé
  quand `opening_date` diffère.
- Décimales FR : `parseDecimal` sur les saisies Comptes, plus de
  `×100` dans l'import CSV en mode virgule.
- Docusaurus : `LedgerStrip` déplacé hors de `pages/` pour ne pas
  être routé comme une page.

### Added
- 8 nouveaux tours guidés (envelopes, rules/list, …).
- Section Transactions dans les Réglages avec compte par défaut,
  pré-sélectionné dans les nouvelles transactions.
- Toggle « pin » remplaçant la case à cocher checkpoint,
  info-tip flottante expliquant la colonne SOLDE.

### Changed
- ESLint 9 activé avec plafond de 300 lignes par fichier source,
  lancé en CI avant le type-check.
- `Layout.tsx` et la page Transactions éclatés en sous-modules
  focalisés ; hooks extraits (`useAccountsReorder`,
  `useCategoriesDrag`, `useDuplicatesMutations`, `useBalanceChart
  Interactions`, …).
- Contrats API partagés regroupés dans `shared/api-contracts` ;
  `parseId`/`isPgError` centralisés + gestionnaire d'erreur global.
