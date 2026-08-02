# Changelog

Toutes les versions notables d'Athena Accounting sont listées ici.

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) ;
le projet suit [SemVer](https://semver.org/lang/fr/) — `MAJOR.MINOR.PATCH`.

Chaque section porte la version et la date au format `YYYY-MM-DD`.
Le workflow `.github/workflows/release.yml` extrait la section
correspondant au tag `vX.Y.Z` et la publie comme corps de la release
GitHub — garder ce format exact (`## [X.Y.Z] - YYYY-MM-DD`).

## [Unreleased]

## [1.0.0-rc.2] - 2026-08-03

Première release **unifiée** : un seul tag `vX.Y.Z` publie désormais une
seule page de release portant les installateurs desktop (`.dmg` macOS,
`.AppImage` Linux, `.exe` Windows) en pièces jointes **et** les images
Docker GHCR. Le canal de tags séparé `v*-desktop*` est retiré ; le badge
« Latest » du dépôt pointera toujours sur la dernière version stable.

### Added
- Synchronisation bancaire : **heure de récupération configurable**
  directement dans l'onglet *Données → Synchronisation bancaire*
  (réglage par utilisateur, 02:00 par défaut). Le planificateur applique
  un rattrapage au démarrage : un serveur allumé en continu synchronise
  à l'heure choisie, l'app desktop fermée pendant la nuit rattrape à son
  prochain lancement.
- Synchronisation bancaire : affichage de la **dernière** et de la
  **prochaine** récupération automatique dans l'onglet.
- Synchronisation bancaire : **bandeau d'avertissement** quand un
  consentement expire sous 14 jours — en plus de la pastille ambre déjà
  présente sur chaque connexion — pour reconnecter la banque avant
  l'interruption.

### Fixed
- Transactions : les épingles de point de contrôle et l'avertissement de
  dérive ne s'affichent plus quand une recherche ou un filtre
  (catégorie, montant, fichier source) tronque les journées visibles.
  La « fin de journée » de la vue filtrée pouvait être une ligne de
  milieu de journée : fausse dérive signalée, et une épingle posée là
  aurait figé un solde intermédiaire. La colonne SOLDE reste affichée —
  ses valeurs sont calculées côté serveur sur l'historique complet et
  restent justes sous n'importe quel filtre.
- Images Docker : étapes de build épinglées sur `$BUILDPLATFORM` — la
  publication multi-arch passait 90+ minutes à émuler le build frontend
  sous QEMU ; elle prend désormais ~2 minutes.
- Tests backend : `npx vitest run` fonctionne à nouveau sans aucune
  variable d'environnement (secret de session et driver PGlite par
  défaut dans le setup de la suite).

### Changed
- Workflow de release unifié : la matrice desktop (build du sidecar,
  smoke du bundle, build Tauri, smoke de l'application installée) vit
  dans `release.yml` ; la publication est conditionnée à **tous** les
  livrables.
- Versioning desktop aligné sur le tag : `tauri.conf.json` porte
  désormais le `X.Y.Z` nu (fini les versions `-desktop-rcN`).

## [1.0.0-rc.1] - 2026-07-31

Première release candidate du serveur familial (Docker). Les binaires
desktop suivent leur propre canal de tags (`v*-desktop*`).

### Added
- Synchronisation bancaire optionnelle via Enable Banking (identifiants
  personnels, lecture seule) : onglet *Données → Synchronisation
  bancaire*, synchro nocturne désactivable (`BANK_SYNC_AUTO=0`), même
  pipeline que les imports de fichiers (déduplication, règles,
  virements, récurrences). Voir `docs/users/bank-sync.md`.
- Dashboard : projection du solde basée sur les moyennes mensuelles
  par compte (courbe « dents de scie » raccordée sans saut vertical).
- Transactions : raccourcis clavier sur la liste (navigation, édition,
  suppression, recherche), annulation pendant 5 secondes après une
  suppression simple ou groupée, avertissement ambre sur les
  checkpoints divergents, date de checkpoint modifiable.
- Règles : onglet « Virements » pour gérer les mots-clés de détection
  des virements internes.
- Comptes : info-bulle d'aide avec exemples sur le champ Type.
- Publication d'une release GitHub à partir d'un tag `vX.Y.Z`
  (`.github/workflows/release.yml`), avec extraction automatique
  des notes depuis ce fichier.
- Images Docker multi-arch (amd64 + arm64) publiées sur GHCR à chaque
  release, et `docker-compose.release.yml` pour démarrer la pile sans
  build local (version épinglable via `ATHENA_VERSION`).
- Tests bout-en-bout : suite Playwright full-stack (vrai backend +
  Postgres) dans la CI, et smoke de l'application installée
  (dmg/AppImage/NSIS) dans le workflow de release desktop.

### Fixed
- Tests backend en CI : sérialisation des fichiers de test
  (`fileParallelism: false`) — les fichiers partagent la même base
  Postgres et plusieurs faisaient des `db.delete(users|accounts)`
  globaux, ce qui effaçait les fixtures des autres fichiers en
  parallèle et cassait ~65 tests avec des violations FK.
- Champs « aujourd'hui » calculés sur le jour calendaire local plutôt
  qu'UTC.
- Aperçu d'import : tableau maintenu en ordre de date en présence de
  doublons.
- Type de compte traduit sur la carte de la page Comptes.

### Changed
- Node 20 → 22 dans les workflows CI et les images Docker de base.

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
