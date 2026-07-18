---
title: Base de données
sidebar_position: 4
---

# Base de données

**Statut :** brouillon — contenu à venir.

## Ce que cette page couvrira

Les points saillants du schéma, le flux des migrations et les extensions
PostgreSQL dont Athena dépend (`pg_trgm`, `unaccent`, `pgcrypto`). Cette
page est destinée aux personnes qui modifient le schéma ; si vous voulez
seulement interroger la base, les types de l'ORM se documentent
eux-mêmes.

## Sections prévues

- [ ] Extensions et raisons (`pg_trgm`, `unaccent`, `pgcrypto`)
- [ ] Tables clés et leurs invariants
- [ ] Migrations avec Drizzle
- [ ] Triggers différés (fractionnements de transaction)
- [ ] Colonnes de recherche plein texte (brutes et normalisées)

*Voir aussi :* [Architecture](architecture.md) ·
[Développement](development.md)

← [Retour aux docs contributeurs](README.md)
