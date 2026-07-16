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
