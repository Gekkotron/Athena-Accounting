# Database

**Status:** draft — content coming.

## What this page will cover

Schema highlights, migration workflow, and the PostgreSQL extensions
Athena depends on (`pg_trgm`, `unaccent`, `pgcrypto`). This page is
for people modifying the schema; if you only want to query the DB,
the ORM types are self-documenting.

## Planned sections

- [ ] Extensions and why (`pg_trgm`, `unaccent`, `pgcrypto`)
- [ ] Key tables and their invariants
- [ ] Migrations with Drizzle
- [ ] Deferrable triggers (transaction splits)
- [ ] Full-text search columns (raw and normalised)

*See also:* [Architecture](architecture.md) ·
[Development](development.md)

← [Back to contributor docs](README.md)
