---
title: Endpoints d'API
sidebar_position: 3
---

# Endpoints d'API

La surface REST appelée par le frontend d'Athena. Toutes les routes
sont préfixées par `/api/…` et servies par le backend Fastify. Voir
[Architecture](../contributors/architecture.md) pour le contexte du
flux de requêtes autour de cette page.

Sauf indication contraire dans la colonne « Auth », chaque endpoint
requiert un cookie de session : l'utilisateur appelant doit être
authentifié via `POST /api/auth/login`. Le plugin cantonne chaque
requête à `req.session.userId`, si bien qu'un identifiant de session
volé depuis une autre machine ne voit que ses propres lignes.

Les réponses sont en JSON. Les codes `4xx` renvoient `{ error: "…" }`
(souvent accompagné de `issues: […]` pour les erreurs de parsing
Zod) ; les codes `5xx` renvoient un payload générique et une entrée
dans les logs du serveur.

## Auth

| Méthode | Chemin              | Auth    | Rôle |
| ------- | ------------------- | ------- | ---- |
| `POST`  | `/api/auth/login`   | Public  | Vérifie nom d'utilisateur + mot de passe, régénère l'id de session, place `userId` / `username` sur la session. Limité à 10 tentatives / IP / minute. Temps de réponse stabilisé via un hash factice pour empêcher l'énumération des comptes par mesure de latence. Retourne `{ user: { id, username } }`, `401` si identifiants invalides. |
| `POST`  | `/api/auth/logout`  | Session | Détruit le cookie de session. |
| `GET`   | `/api/auth/me`      | Session | Retourne `{ user: { id, username } }`. Utilisé par le frontend pour détecter une session encore active au chargement d'une page. |
| `PATCH` | `/api/auth/me`      | Session | Change `username` et/ou `newPassword`. `currentPassword` est toujours requis (une session compromise ne peut pas verrouiller le vrai utilisateur). Limité à 10 / IP / minute. `409` en cas de collision de nom. |

## Onboarding

Deux endpoints qui gèrent le flux « premier utilisateur ». Publics.

| Méthode | Chemin                   | Auth   | Rôle |
| ------- | ------------------------ | ------ | ---- |
| `GET`   | `/api/onboarding/status` | Public | `{ needsOnboarding: boolean }` — `true` ssi la table `users` est vide. |
| `POST`  | `/api/onboarding/create` | Public | Enregistre un nouvel utilisateur (mot de passe ≥ 8 caractères), amorce la catégorie « Divers » par défaut, pose le cookie de session. Limité à 5 / IP / minute. Ouvert par conception sur une installation LAN — restreindre via firewall ou VPN si besoin. `409` en cas de collision de nom. |

## Comptes

Comptes bancaires / bourse / espèces. Toutes les routes nécessitent
une session.

| Méthode  | Chemin                          | Rôle |
| -------- | ------------------------------- | ---- |
| `GET`    | `/api/accounts`                 | Liste avec `currentBalance`, `availableBalance` (retire `lockYears`) et compteurs de transactions par compte, calculés en une passe SQL brute. |
| `POST`   | `/api/accounts`                 | Création. Body : `{ name, type, currency, openingBalance, openingDate, lockYears? }`. `409` sur collision `(user_id, name)`. |
| `PUT`    | `/api/accounts/order`           | Réordonnancement en masse. Body : `{ ids: number[] }` — écrit `display_order = index`. Refuse les ids en double. Enveloppé dans une transaction. |
| `GET`    | `/api/accounts/:id`             | Ligne unique. |
| `PUT`    | `/api/accounts/:id`             | Mise à jour partielle d'un sous-ensemble de `{ name, type, currency, openingBalance, openingDate, lockYears }`. |
| `DELETE` | `/api/accounts/:id`             | `409` si le compte contient encore des transactions (FK `ON DELETE RESTRICT`). |
| `POST`   | `/api/accounts/:sourceId/merge` | Fusionne `sourceId` dans `targetId`. Body : `{ targetId }`. Déplace les transactions (déduplication sur FITID / date-montant-libellé normalisé), propage le `lockYears` du compte vers les surcharges par ligne, effondre les groupes de virements désormais tous sur la cible, redirige les tables satellites (patterns de fichiers, checkpoints, budgets, imports, templates PDF, brouillons PDF), augmente `target.openingBalance` de `source.openingBalance`, supprime la source. Tout en une transaction. |

### Checkpoints de solde

Marqueurs de solde attendu par compte, utilisés pour rapprocher avec
les relevés.

| Méthode  | Chemin                                          | Rôle |
| -------- | ----------------------------------------------- | ---- |
| `GET`    | `/api/accounts/:id/balance-checkpoints`         | Liste pour un compte, du plus ancien au plus récent. |
| `POST`   | `/api/accounts/:id/balance-checkpoints`         | Body : `{ checkpointDate, expectedAmount, note? }`. `409` sur collision `(account_id, checkpoint_date)`. |
| `PUT`    | `/api/accounts/:id/balance-checkpoints/:cpId`   | Patch `expectedAmount` et/ou `note`. La date est immuable — le client supprime + recrée pour la déplacer. |
| `DELETE` | `/api/accounts/:id/balance-checkpoints/:cpId`   | `204` en cas de succès. |

### Patterns de nom de fichier

Aiguillent les imports vers les comptes selon un glob de nom de
fichier.

| Méthode  | Chemin                                | Rôle |
| -------- | ------------------------------------- | ---- |
| `GET`    | `/api/account-filename-patterns`      | Liste, priorité descendante. |
| `POST`   | `/api/account-filename-patterns`      | Body : `{ pattern, accountId, priority? }`. |
| `PUT`    | `/api/account-filename-patterns/:id`  | Mise à jour partielle. |
| `DELETE` | `/api/account-filename-patterns/:id`  | Suppression. |

## Catégories

Taxonomie sur deux niveaux : dépense / revenu / neutre.

| Méthode  | Chemin                | Rôle |
| -------- | --------------------- | ---- |
| `GET`    | `/api/categories`     | Liste, triée par kind puis nom. |
| `POST`   | `/api/categories`     | Création. Body : `{ name, kind, color?, parentId?, isInternalTransfer? }`. Un enfant hérite du `kind` du parent. Refuse un `parentId` qui a lui-même un parent (seulement 2 niveaux). |
| `PUT`    | `/api/categories/:id` | Mise à jour partielle. Garde-fous : pas d'auto-parent, impossible d'imbriquer une catégorie qui a déjà des enfants, `parentId` doit exister et être de premier niveau, un changement de kind sur un parent cascade sur ses enfants. |
| `DELETE` | `/api/categories/:id` | `409` si la ligne est la catégorie par défaut (« Divers »). |

## Transactions

Orientées bulk. Chaque mutation est cantonnée au `userId` de
l'appelant.

| Méthode  | Chemin                                     | Rôle |
| -------- | ------------------------------------------ | ---- |
| `POST`   | `/api/transactions`                        | Création manuelle. Body : `accountId`, `date`, `amount`, `rawLabel`, plus `categoryId` / `notes` / `lockYears` en option. Le serveur calcule `normalizedLabel` + `dedupKey`. Si `categoryId` est omis, le moteur de règles s'exécute (même chemin de code qu'à l'import). `409` si (compte, date, montant, libellé normalisé) identique. |
| `GET`    | `/api/transactions`                        | Liste paginée. Query : `accountId`, `categoryId` (match direct ou via un split), `sourceFileId`, `fromDate`, `toDate`, `minAmount`, `maxAmount`, `amount` (sans signe, plage à élargissement progressif), `search` (sous-chaîne insensible à la casse et aux accents sur raw / normalized / memo / notes), `includeTransfers`, `sort` (`date` / `amount` / `label`), `order`, `limit ≤ 500`, `offset`. Quand `accountId` est fixé, chaque ligne porte un `runningBalance`. Chaque ligne est hydratée avec ses `splits[]`. |
| `GET`    | `/api/transactions/:id`                    | Ligne unique, hydratée avec les splits. |
| `PATCH`  | `/api/transactions/:id`                    | Mise à jour partielle de `{ accountId, date, amount, rawLabel, categoryId, notes, lockYears }`. Toucher `categoryId` bascule `category_source` en `manual`, de sorte que le recatégoriseur rétroactif l'ignore sous `preserveManual: true`. Éditer `amount` échoue en `409` s'il existe une ventilation (supprimer les splits d'abord). |
| `POST`   | `/api/transactions/delete-bulk`            | Body : `{ ids: number[] }` (≤ 500). Délie chaque contrepartie de virement encore possédée par l'utilisateur, puis supprime l'ensemble, en une transaction. |
| `POST`   | `/api/transactions/categorize-bulk`        | Body : `{ ids, categoryId }`. Les lignes qui sont des jambes de virement ou des parents de split sont reportées en `skipped` ; les autres passent en `category_source = 'manual'`. |
| `DELETE` | `/api/transactions/:id`                    | Délie la contrepartie de tout virement auquel appartient la ligne avant de la supprimer. |
| `GET`    | `/api/transactions/duplicates`             | Groupes de doublons « souples » : même `(compte, date, montant)` mais `dedup_key` différent et au moins une ligne encore non marquée. Query : `accountId?`. |
| `POST`   | `/api/transactions/mark-not-duplicate`     | Body : `{ ids: number[] }`. Passe `not_duplicate = true` pour que le groupe disparaisse de `/duplicates`. |
| `GET`    | `/api/transactions/:id/splits`             | Liste les ventilations d'une transaction parente. |
| `PUT`    | `/api/transactions/:id/splits`             | Remplace les splits atomiquement. Body : `{ splits: [{ categoryId, amount, memo? }, …] }` (2 à 20 items). Contrôles : non-nul, signe identique au parent, somme égale au parent, `categoryId` possédés par l'appelant. Refusé sur un parent virement interne. |
| `DELETE` | `/api/transactions/:id/splits`             | Supprime toutes les ventilations sous un parent. |

## Imports

Ingestion OFX / QFX / CSV / PDF et gestion des templates PDF.

| Méthode  | Chemin                                   | Rôle |
| -------- | ---------------------------------------- | ---- |
| `POST`   | `/api/imports`                           | Upload multipart. Le serveur déduit le format de l'extension (`.ofx` / `.qfx` / `.csv` / `.pdf`). Compte cible : query `?accountId=…` ou correspondance de pattern de nom de fichier. Erreurs PDF : `413 pdf_too_large` (> 10 Mo), `400 pdf_encrypted`, `422 template_yielded_no_rows`. Pour un PDF peut retourner `{ kind: 'needs_template' \| 'imported', … }` — le wizard prend la suite. |
| `POST`   | `/api/imports/photo`                     | Photo multipart (JPEG/HEIC/PNG) → OCR de reçu. Requiert `?accountId=…`. Max 25 Mo. |
| `POST`   | `/api/imports/preview`                   | Mêmes formats que `/api/imports` (sauf PDF), mais N'INSÈRE PAS — renvoie ce qui serait importé. Alimente la boîte de dialogue de pré-import. |
| `POST`   | `/api/imports/pdf/templates`             | Enregistre zones + label pour un brouillon PDF et lance l'import. Body : `{ draftId, label, zones, override_rows? }`. `410 draft_expired`, `422 template_yielded_no_rows`. |
| `POST`   | `/api/imports/pdf/templates/preview`     | Essaie des zones sur un brouillon sans sauvegarder. Renvoie les lignes candidates pour le wizard. `410 draft_expired`. |
| `GET`    | `/api/imports`                           | Les 100 imports les plus récents, chacun enrichi de `computedBalance` et `delta` face à `statedBalance` quand présent. |
| `GET`    | `/api/imports/:id`                       | Un import, enrichi. |
| `GET`    | `/api/imports/pdf/drafts/:id`            | Items de texte de page + statut OCR du brouillon (le wizard s'en sert pour afficher le PDF pour la sélection des zones). |
| `GET`    | `/api/imports/pdf/drafts/:id/ocr-status` | Sonde légère : `{ status, progress, total, error? }`. Interrogée pendant l'OCR d'un PDF scanné. |
| `PATCH`  | `/api/imports/:id`                       | Enregistre `statedBalance` et/ou `statedBalanceDate` depuis le relevé imprimé pour que l'app calcule le delta de rapprochement. Chaque champ peut être annulé. |
| `DELETE` | `/api/imports/:id`                       | Suppression en cascade : supprime la ligne `file_imports` ET toutes les transactions dont `source_file_id` la vise, en une transaction. |

### Templates PDF

Cartes de zones enregistrées, indexées par empreinte d'en-tête +
compte.

| Méthode  | Chemin                   | Rôle |
| -------- | ------------------------ | ---- |
| `GET`    | `/api/pdf-templates`     | Liste. Les zones sont retirées du payload — le frontend n'a besoin que des métadonnées + ancres. |
| `PUT`    | `/api/pdf-templates/:id` | Renomme ou remplace les zones. Les zones sont revalidées côté serveur. |
| `DELETE` | `/api/pdf-templates/:id` | `204` en cas de succès. |

### Rapprochement

Confronte un PDF de relevé aux transactions existantes sans importer.

| Méthode | Chemin           | Rôle |
| ------- | ---------------- | ---- |
| `POST`  | `/api/reconcile` | Body : `{ pdfBase64, accountId, fromDate?, toDate? }`. Réutilise le template PDF sauvegardé (sinon `422 needs_template` avec raison `no_text_layer` / `no_template` / `template_stale`). Élargit la fenêtre DB de ±3 jours pour le matching flou, puis renvoie les buckets matched / missing / extra / duplicate ainsi qu'un `summaryText` en français. |

## Règles et catégorisation

Moteur de règles qui attribue des catégories à l'import et à la
demande.

| Méthode  | Chemin              | Rôle |
| -------- | ------------------- | ---- |
| `GET`    | `/api/rules`        | Toutes les règles, priorité descendante. |
| `POST`   | `/api/rules`        | Body : `{ categoryId, keyword, signConstraint, matchMode, priority?, enabled? }`. |
| `PUT`    | `/api/rules/:id`    | Mise à jour partielle. |
| `DELETE` | `/api/rules/:id`    | Suppression. |
| `POST`   | `/api/recategorize` | Réexécute le moteur sur tout l'historique non-virement. Body : `{ preserveManual?: boolean }` (défaut `true` — les choix manuels sont préservés). Renvoie les compteurs. |

### Règles de virement

Détectent automatiquement les virements internes par mot-clé +
direction.

| Méthode  | Chemin                    | Rôle |
| -------- | ------------------------- | ---- |
| `GET`    | `/api/transfer-rules`     | Liste. |
| `POST`   | `/api/transfer-rules`     | Body : `{ keyword, direction: 'outgoing'\|'incoming', counterpartAccountId?, enabled? }`. |
| `PUT`    | `/api/transfer-rules/:id` | Mise à jour partielle. |
| `DELETE` | `/api/transfer-rules/:id` | Suppression. |

### Tri (file de catégorisation)

Catégorisation en masse de la longue traîne de transactions
non-catégorisées.

| Méthode | Chemin            | Rôle |
| ------- | ----------------- | ---- |
| `GET`   | `/api/tri/groups` | Groupes de transactions non-catégorisées (ou tombées dans le bucket par défaut) rassemblées par `normalized_label`, les plus fréquentes d'abord. Query : `limit`, `offset`. |
| `POST`  | `/api/tri/assign` | Body : `{ groups: [{ normalizedLabel, categoryId }], createRules?: boolean }`. Ne touche que les lignes encore « à trier », de sorte qu'un choix manuel sur une ligne sœur n'est jamais écrasé. Si `createRules: true`, insère aussi une règle `word` par affectation. |

## Agrégats du dashboard

Les quatre endpoints `/api/reports/…` alimentent le Dashboard. Tous
nécessitent une session et excluent les jambes de virement (leurs deux
côtés s'annulent et pollueraient sinon chaque agrégat).

| Méthode | Chemin                     | Rôle |
| ------- | -------------------------- | ---- |
| `GET`   | `/api/reports/balance`     | Solde total groupé par devise. Divise chaque total par devise en `total`, `available` (retire `lockYears` sur le compte et par ligne) et `invested` (le sous-ensemble d'`available` sur un compte de `type = 'investment'`). Les comptes multi-devises restent séparés — pas de conversion automatique. |
| `GET`   | `/api/reports/timeseries`  | Solde cumulé par compte au fil du temps. Query : `fromDate`, `toDate`, `granularity: 'day'\|'month'`. Les jambes de virement SONT incluses ici — elles affectent les soldes par compte même si elles sont neutres globalement. |
| `GET`   | `/api/reports/categories`  | Dépenses par (catégorie, mois). Le CTE virtualise les splits, si bien qu'un split à 3 compte comme 3 lignes attribuées à leurs propres catégories de split. Query : `fromDate`, `toDate`, `accountId?`. Virements exclus. |
| `GET`   | `/api/reports/budget`      | Prévu / réel par catégorie de dépense budgétée, mensuel ou annuel. Query : `period='monthly'\|'yearly'`, `month?` (`YYYY-MM`) ou `year?` (`YYYY`), `accountId?`. Par ligne : `spent`, `remaining`, `pct`, `over`, `projected` (extrapolation linéaire à partir de ≥ 3 jours écoulés ; `null` avant), `history` sur 6 périodes (avec `average` / `median`), `anomaly` (spent > 1σ de la moyenne), `suggestedLimit` (proposition arrondie quand la limite actuelle paraît inadaptée). Renvoie aussi `unbudgetedCandidates`. |

## Budgets

Mode plafond de catégorie et mode enveloppes. Les deux modes ne
partagent pas de tables.

### Budgets par catégorie

| Méthode  | Chemin             | Rôle |
| -------- | ------------------ | ---- |
| `GET`    | `/api/budgets`     | Liste. |
| `POST`   | `/api/budgets`     | Body : `{ categoryId, monthlyLimit, currency?, period?, accountId? }`. `accountId: null` (ou omis) = « global » (tous comptes). `409 budget_exists` sur doublon `(user_id, category_id, period, account_id)`. |
| `PUT`    | `/api/budgets/:id` | Mise à jour partielle. |
| `DELETE` | `/api/budgets/:id` | `204` en cas de succès. |

### Enveloppes

Indépendant de `/api/budgets`. Voir
`docs/superpowers/specs/2026-07-16-budget-modes-design.md` pour la
justification de conception.

| Méthode  | Chemin                                  | Rôle |
| -------- | --------------------------------------- | ---- |
| `GET`    | `/api/envelopes/assignments`            | Affectations pour `?month=YYYY-MM`. |
| `PUT`    | `/api/envelopes/assignments`            | Upsert d'une affectation `(categoryId, month)`. |
| `DELETE` | `/api/envelopes/assignments/:id`        | Supprime une affectation. |
| `POST`   | `/api/envelopes/reallocate`             | Déplace de l'argent entre deux catégories sur un mois. Body : `{ fromCategoryId, toCategoryId, month, amount }`. En une transaction. |
| `GET`    | `/api/envelopes/categories`             | Paramètres par catégorie (montant / date / kind cible, politique de dépassement). |
| `PUT`    | `/api/envelopes/categories/:categoryId` | Upsert des paramètres d'une catégorie. |
| `DELETE` | `/api/envelopes/categories/:categoryId` | Réinitialise aux valeurs par défaut. |
| `GET`    | `/api/envelopes/holds`                  | Réserves dans `?from=YYYY-MM&to=YYYY-MM`. |
| `PUT`    | `/api/envelopes/holds`                  | Upsert d'une réserve `(month, amount)`. `amount = 0` supprime la ligne. |
| `GET`    | `/api/envelopes/report`                 | Rapport de mois assemblé pour `?month=YYYY-MM` : pool (revenus cumulés, assignés cumulés, retenus des mois précédents, retenus pour le suivant, disponible) plus lignes par catégorie (balance du mois précédent, affectation du mois, dépenses du mois, balance en cours, cible, politique de dépassement, `absorbedByPool`). |

## Paramètres

| Méthode  | Chemin                    | Rôle |
| -------- | ------------------------- | ---- |
| `GET`    | `/api/settings`           | Charge le JSONB de paramètres fusionné (scope du graphique du dashboard, etc.). Un `dashboardChartScope` pointant vers un compte supprimé ou d'un autre tenant est silencieusement forcé à `'all'`. |
| `PATCH`  | `/api/settings`           | Fusionne un patch de manière superficielle dans le JSONB stocké — la partie droite gagne clé par clé. |
| `GET`    | `/api/settings/mcp`       | État du token MCP : `{ enabled, hasToken }`. |
| `PUT`    | `/api/settings/mcp`       | Body : `{ enabled: boolean }` — bascule l'accès MCP sans régénérer le token. |
| `POST`   | `/api/settings/mcp/token` | Génère un token frais de 32 octets, dérive la clé de contenu, l'emballe sous une clé maître dérivée de `SESSION_SECRET`, stocke la clé emballée, renvoie le token en clair UNE seule fois. La régénération écrase la clé précédente. |
| `DELETE` | `/api/settings/mcp/token` | Efface la clé emballée (les appels MCP renvoient désormais `401`). |

### Astuces

État des astuces d'onboarding fermées par l'utilisateur.

| Méthode | Chemin                | Rôle |
| ------- | --------------------- | ---- |
| `GET`   | `/api/tips/dismissed` | `{ dismissed: { [tipId]: timestamp } }`. |
| `POST`  | `/api/tips/dismiss`   | Body : `{ id }`. Upsert d'une entrée. `204`. |
| `POST`  | `/api/tips/undismiss` | Body : `{ id }`. Retire une entrée. `204`. |
| `POST`  | `/api/tips/reset`     | Efface toutes les fermetures. `204`. |

## Sauvegarde

Export / restauration en JSON portable.

| Méthode | Chemin               | Rôle |
| ------- | -------------------- | ---- |
| `GET`   | `/api/backup/export` | Émet un dump JSON indexé par noms naturels (noms de comptes / catégories, pas d'ids numériques). Multi-utilisateur sûr — seules les données de l'appelant sont incluses. Les règles de virement sont volontairement omises (remplacées par le drapeau `is_internal_transfer` sur les catégories) ; les anciens dumps continuent de faire le round-trip grâce au champ optionnel conservé dans le schéma. |
| `POST`  | `/api/backup/import` | Sémantique REPLACE, cantonnée à l'appelant. Efface uniquement les lignes de cet utilisateur (en ordre inverse des dépendances) et réinsère chaque ligne du dump sous le `user_id` de l'appelant. Body limité à 50 Mo. |

## MCP

Surface RPC chiffrée pour le serveur MCP d'Athena (agents Claude /
IDE). Seule route qui n'utilise pas le cookie de session — elle
effectue sa propre authentification cryptographique.

| Méthode | Chemin         | Auth   | Rôle |
| ------- | -------------- | ------ | ---- |
| `POST`  | `/api/mcp/rpc` | Public | Enveloppe : `{ user, v: 1, nonce, ct }`. Le serveur cherche l'utilisateur, déballe la clé de contenu (via la clé maître dérivée de `SESSION_SECRET`), déchiffre, valide l'horodatage contre une tolérance de ±2 minutes, dispatche vers une opération whitelistée (`list_accounts`, `list_categories`, `search_transactions`, `create_transaction`, `update_transaction`, `delete_transaction`, `reconcile_statement`), puis renvoie la réponse chiffrée avec la même clé. Chaque op est servie en injectant une requête interne sur la route REST correspondante avec le `userId` de l'appelant estampillé par l'en-tête d'auth interne. Limité à 60 / IP / minute. |

*Voir aussi :* [Architecture](../contributors/architecture.md)

← [Retour à l'index de la référence](README.md)
