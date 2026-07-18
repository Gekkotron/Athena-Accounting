---
title: Base de données
sidebar_position: 4
---

# Base de données

Cette page s'adresse aux personnes qui modifient le schéma. Si vous
voulez seulement interroger la base, les types Drizzle dans
`backend/src/db/schema.ts` se documentent eux-mêmes.

Pour le contexte de plus haut niveau (comment le backend, la base et
les autres conteneurs s'articulent), voir
[Architecture](architecture.md).

## Extensions PostgreSQL

Athena requiert trois extensions. Chacune est chargée dans la toute
première migration (`0000_init.sql`) et doit exister dans l'image
Postgres utilisée par Compose (l'image officielle `postgres:16` les
fournit toutes les trois).

### `pg_trgm` — recherche plein texte indexée par trigrammes

L'onglet Tri regroupe les transactions non catégorisées par *libellés
similaires*, et le moteur de règles compare les mots-clés à tous les
libellés jamais importés. Les deux sont des chemins chauds sur
l'intégralité de la table `transactions`.

On conserve deux index sur `transactions.normalized_label` :

- un B-tree simple sur
  `immutable_unaccent(lower(normalized_label))` pour les recherches
  exactes insensibles aux accents et à la casse (matching des règles) ;
- un index GIN utilisant `gin_trgm_ops` pour la similarité par
  trigrammes — c'est ce qui alimente le regroupement « même libellé »
  dans Tri et la suggestion floue lors de la création d'une règle
  depuis une transaction.

Sans `pg_trgm`, l'index GIN ne peut pas être créé et l'onglet Tri
dégénère en un scan séquentiel complet à chaque frappe.

### `unaccent` — repliage des accents

Les libellés français mélangent régulièrement graphies accentuées et
non accentuées pour le même commerçant (`AMÉLIE`, `AMELIE`, `amélie`).
On normalise à l'import (`normalized_label` est écrit sans accents et
en minuscules) pour que les recherches n'aient pas à le refaire, mais
deux endroits en ont encore besoin à l'exécution : le matching des
règles contre `keyword`, et la recherche par trigrammes ci-dessus.

Postgres marque `unaccent(...)` comme `STABLE` par défaut, ce qui
interdit son usage dans une expression d'index. `0000_init.sql` définit
donc une enveloppe SQL `IMMUTABLE` — `immutable_unaccent(text)` — et
chaque index fonctionnel appelle cette enveloppe plutôt que la
fonction brute.

### `pgcrypto` — UUID (et défense en profondeur)

`transactions.transfer_group_id` est un UUID qui relie les deux jambes
d'un virement interne. Les lignes sont générées côté serveur avec
`gen_random_uuid()`, fournie par `pgcrypto`. C'est la seule dépendance
d'exécution à l'intérieur de la couche SQL.

Le chiffrement du jeton MCP se fait en Node (`AES-256-GCM` via
`node:crypto`, voir `backend/src/domain/mcp/crypto.ts`) — Postgres ne
stocke que le blob base64 résultant dans
`user_settings.mcp_key_wrapped`. L'extension reste chargée parce que
`gen_random_uuid()` n'est disponible que si `pgcrypto` est installée,
et parce que de futures migrations souhaitant du chiffrement par
colonne (`pgp_sym_encrypt` / `pgp_sym_decrypt`) n'auront ainsi pas
besoin d'une migration préalable pour activer l'extension.

## Tables clés et invariants

Les définitions colonne par colonne vivent dans
`backend/src/db/schema.ts`. La liste ci-dessous cartographie les
invariants sur lesquels l'application s'appuie — ce que vous casserez
si vous les ignorez dans une nouvelle migration.

### `users`

Une ligne par compte local. `password_hash` est la sortie argon2id ;
le plugin d'authentification Fastify ne lit jamais le mot de passe
brut. La suppression en cascade supprime toutes les lignes que ce
compte possède dans le schéma — les colonnes `user_id` par table
existent précisément pour rendre la suppression type RGPD faisable en
une seule instruction.

### `accounts`

`(user_id, name)` est unique. Chaque solde rapporté est calculé comme
`opening_balance + SUM(amount WHERE date >= opening_date)` ; ces deux
colonnes sont donc obligatoires. `currency` est par compte (pas encore
de table de change). `lock_years`, si renseigné, marque les fonds
comme « bloqués » jusqu'à `opening_date + lock_years` — c'est la
source du partage « Disponible / Bloqué » du Tableau de bord.

### `transactions`

Une ligne par jambe. Un virement interne se compose de deux lignes
reliées par `transfer_group_id` ; les agrégats qui rapportent
dépenses/revenus excluent ces lignes via
`WHERE transfer_group_id IS NULL`.

Les ré-imports idempotents reposent sur
`UNIQUE(account_id, dedup_key)`. `dedup_key` est le `FITID` OFX quand
le fichier source en fournit un, sinon
`sha1(account|date|amount|normalized_label)`.

`raw_label` est la chaîne livrée par la banque ; `normalized_label`
en est la version sans accents et en minuscules, utilisée par les
règles et la recherche plein texte. Les deux index plein texte décrits
sous `pg_trgm` ci-dessus reposent sur `normalized_label`.

`category_source` enregistre comment la catégorie courante a été
définie (`manual`, `auto`, `default`, `llm`). La passe de
re-catégorisation rétroactive respecte `preserveManual: true` en
refusant de toucher aux lignes où `category_source = 'manual'`.

### `rules` et `transfer_rules`

`rules` assigne une catégorie quand un mot-clé matche
`immutable_unaccent(lower(normalized_label))`. `sign_constraint`
empêche une règle « dépense » de se déclencher sur un montant
positif. `match_mode` choisit entre matching par mot, par sous-chaîne
ou par regex ; la valeur par défaut `'word'` empêche `"paye"` de
matcher `"payweb"`.

`transfer_rules` n'assigne pas de catégorie. Elle marque une
transaction comme une jambe d'un virement interne et la relie à sa
jambe miroir via `transfer_group_id`.

### `category_budgets`, `envelope_assignments`, `envelope_category_settings`, `envelope_month_holds`

Deux modèles budgétaires mutuellement exclusifs cohabitent :

- **Mode Plafonds** — `category_budgets` contient un plafond
  récurrent par `(utilisateur, catégorie, période)`, optionnellement
  restreint à un seul compte. L'unicité est imposée par deux index
  partiels : un sur `(user_id, category_id, period) WHERE account_id IS NULL`
  (global) et un sur
  `(user_id, category_id, period, account_id) WHERE account_id IS NOT NULL`
  (restreint).
- **Mode Enveloppe** — `envelope_assignments` alloue un montant par
  mois et par catégorie (unique sur
  `(user, category, month)`). `envelope_category_settings` stocke les
  cibles optionnelles et la politique de dépassement.
  `envelope_month_holds` implémente le tampon « réserver pour le mois
  prochain ».

### `balance_checkpoints`

Points de contrôle manuels par compte. Unique sur
`(account_id, checkpoint_date)`. Affichés en losanges sur la courbe du
Tableau de bord ; quand le solde cumulé calculé s'écarte de
`expected_amount`, le losange devient orangé.

### `file_imports`

Ligne d'audit par fichier importé : `total_lines`, `inserted_count`,
`dedup_skipped`, et éventuellement le `stated_balance` imprimé sur le
relevé. Ré-importer le même fichier produit une nouvelle ligne avec
`inserted_count = 0` et `dedup_skipped = total_lines` — l'UI lit ces
compteurs pour expliquer « 0 nouvelle ligne parce que tout était déjà
présent ».

### `transaction_splits`

Ventilation d'une transaction sur N ≥ 2 catégories. Rattachée à son
parent transitivement via `transaction_id` ; une colonne `user_id`
serait redondante. Deux invariants, imposés par des triggers — voir
[Triggers différés](#triggers-différés-pour-les-fractionnements)
ci-dessous.

### `user_settings`

Une ligne par utilisateur, clé primaire `user_id`. La colonne
`settings` est un blob JSONB façonné par le schéma Zod à
`backend/src/domain/settings/schema.ts` — ajouter une préférence est
une modification Zod, pas une migration. `mcp_enabled` et
`mcp_key_wrapped` conservent l'opt-in du point d'entrée MCP et la clé
de contenu encapsulée (voir `pgcrypto` plus haut).

## Migrations — écriture et application

Les migrations sont des fichiers SQL bruts sous
`backend/src/db/migrations/`, numérotés `NNNN_nom_court.sql`.
`runMigrations()` dans `backend/src/db/migrate.ts` les applique au
démarrage :

1. S'assure qu'une table `schema_migrations(filename, applied_at)`
   existe.
2. Liste tous les fichiers `*.sql` du dossier et les trie par ordre
   lexicographique. **L'ordre est par nom de fichier, pas par mtime** —
   utilisez toujours le préfixe `NNNN` suivant pour qu'un checkout
   frais applique les fichiers dans le même ordre que votre base
   locale.
3. Ignore les fichiers déjà présents dans `schema_migrations`.
4. Encadre chaque fichier par `BEGIN … COMMIT` ; un échec en cours de
   fichier fait un rollback propre et laisse `schema_migrations`
   intacte, si bien que le prochain démarrage réessaie.
5. Passe le SQL brut par `.exec()` du driver pour que les bodies
   multi-instructions fonctionnent sous les deux drivers (`pg` en
   Docker, `@electric-sql/pglite` en Tauri — voir
   [Architecture](architecture.md) pour la fabrique de driver).

Conventions pratiques :

- Une transaction par fichier. Ne mettez pas votre propre
  `BEGIN/COMMIT` dans la migration — le runner s'en charge déjà.
- Gardez le fichier presque idempotent quand ça ne coûte rien
  (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`), mais
  le runner saute déjà les fichiers déjà appliqués, donc c'est
  ceinture et bretelles.
- Gardez `backend/src/db/schema.ts` synchronisé dans le même commit.
  Les types Drizzle sont la source de vérité de la couche API ; toute
  divergence remonte sous forme d'erreurs d'exécution.
- Préférez le SQL brut à la génération par Drizzle Kit. Toutes les
  migrations de cet arbre sont écrites à la main.

## Triggers différés pour les fractionnements

La migration `0014_transaction_splits.sql` installe deux triggers qui
maintiennent les invariants de ventilation honnêtes au niveau de la
base.

**Trigger de checksum** — après tout `INSERT/UPDATE/DELETE` sur
`transaction_splits`, `SUM(amount)` pour le parent concerné doit
valoir soit `parent.amount` (entièrement ventilé), soit `0` (non
ventilé — c'est alors `category_id` du parent qui fait autorité).

Le trigger est `DEFERRABLE INITIALLY DEFERRED`. C'est important parce
qu'une édition courante — « remplacer toutes les splits par un nouveau
lot » — est naturellement un `DELETE` puis N `INSERT` à l'intérieur
d'une même transaction. Pendant les instructions intermédiaires la
somme n'a aucun sens ; seul l'état au commit doit satisfaire
l'invariant.

**Trigger de verrouillage du montant** — `BEFORE UPDATE ON transactions`
refuse toute modification de `amount` tant qu'il existe des splits
pour cette transaction. Sans lui, éditer le parent invaliderait
silencieusement le checksum. L'UI retire l'input du montant quand des
splits existent ; ce trigger est de la défense en profondeur contre
un appel direct à l'API.

## Solde courant (running balance)

Il n'y a pas de colonne `running_balance` persistée. L'endpoint de
liste des transactions (`GET /api/transactions`) le calcule à la
volée, dans un cas précis : la requête est restreinte à un seul
compte (`accountId` dans la query string).

Le calcul vit dans
`backend/src/http/routes/transactions/index.ts` :

1. Récupérer `opening_balance` et `opening_date` du compte ciblé.
2. Sélectionner tout l'historique ordonné pour ce compte
   (`date >= opening_date`, tri sur `(date, id)`).
3. Cumuler `amount` dans une `Map<txId, string>` clé par identifiant
   de transaction.
4. Attacher `runningBalance` à chaque ligne de réponse via la map.

Deux raisons à ce choix :

- **Cohérence avec `currentBalance`.** La page Comptes affiche
  `opening_balance + SUM(amount WHERE date >= opening_date)`. Le solde
  courant utilise la même base, si bien que la dernière ligne visible
  du tableau des transactions se réconcilie toujours avec la carte du
  compte.
- **Stabilité face à la pagination / au tri / aux filtres.** Comme la
  map est clé par identifiant de transaction et calculée sur
  l'*intégralité* de l'historique, changer de page, de tri ou de
  filtre ne fausse jamais la valeur d'une ligne donnée.

Les lignes antérieures à `opening_date` ne reçoivent pas d'entrée et
s'affichent en `—` dans l'UI, comme `currentBalance` les exclut.

## Voir aussi

- [Architecture](architecture.md) — la vue de plus haut niveau sur les
  conteneurs et le flux des requêtes.
- [Plan du code](code-map.md) — où vit le code de la base dans
  l'arbre (`backend/src/db/`).
- [Développement](development.md) — lancer Postgres et PGlite en
  local.

← [Retour aux docs contributeurs](README.md)
