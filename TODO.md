# TODO / Idées

Brainstorming + roadmap pour Athena Accounting. Pas de structure imposée — déplacez
les éléments entre les sections au fur et à mesure que vous décidez quoi faire.

---

## 🧠 Idées (en vrac)

<!-- Tout ce qui passe par la tête, même à demi-formé. Pas obligé que ce soit clair. -->

- Traduire l'app (fr, en) avec detection de la langue du navigateur.
- check if nuextract will be useful https://about.nuextract.ai (self-hosted).
- Update readme with new features + screenshots.
- Renommer un template PDF depuis le panneau (le backend accepte déjà `PUT
  /api/pdf-templates/:id { label }`, il manque juste un champ inline).
- Édition d'un template sans re-uploader le PDF (aperçu des dernières zones
  stockées + form de mise à jour). Cas d'usage : ajuster `otherAnchors` sans
  passer par delete + re-import.
- Bouton "Aperçu" avant de finaliser le wizard : montrer les N premières
  transactions extraites pour vérifier avant de valider les zones.
- Peindre les zones sur une autre page que la première (ZoneCanvas est
  hardcodé sur `pages[0]` — utile quand la première page est un cover / index
  et le tableau commence page 2).
- Détection de transactions récurrentes (Netflix, loyer, salaire) avec
  suggestion de catégorie et alerte "attendu ce mois-ci mais absent".
- Prévisualisation d'une règle : avant de créer, montrer les transactions du
  passé qu'elle aurait matché (compte, montant, sens). Réduit les faux
  positifs.
- Réordonner les règles par drag-and-drop (comme les comptes) — la priorité
  est déjà stockée, il manque juste l'UI @dnd-kit.
- Undo (fenêtre ~5s) après une suppression de transaction ou d'import. Toast
  en bas de l'écran avec bouton "Annuler".
- Raccourcis clavier sur la page Transactions : `j`/`k` naviguer, `e`
  éditer, `d` supprimer, `/` focus recherche.
- Fusionner deux comptes (rename n'est pas suffisant quand on a créé un
  doublon par erreur ; transférer toutes les transactions vers l'un et
  supprimer l'autre).
- Conversion multi-devise via une petite table FX manuelle. Utile pour un
  compte USD/GBP occasionnel sans avoir à connecter une API externe.
- Détection automatique de règles depuis "Tri" : quand l'utilisateur assigne
  N transactions à la même catégorie via le même mot-clé, proposer de créer
  la règle.
- Export CSV filtré (ex. transactions d'une catégorie sur une plage) —
  utile pour la déclaration d'impôts.
- Notifications par mail sur événements : import échoué, dérive checkpoint
  détectée, budget dépassé. SMTP config optionnelle.
- Panel "Insights" mensuel : "vous avez dépensé 20% de plus qu'en juin",
  "3 nouvelles catégories automatiques créées", "10 doublons possibles".
- Backup automatique périodique (cron interne écrivant sur un chemin
  configurable), rétention N jours. Cas d'usage : sauvegarde vers un disque
  monté NAS sans passer par le bouton manuel.
- Metrics Prometheus (`/metrics`) : nombre d'imports, latence des requêtes,
  taille de la DB. Utile en environnement homelab avec Grafana.

### 🔍 Inspirations ezBookkeeping (audit 2026-07-08)

<!-- Comparaison des features de ezbookkeeping.mayswind.net avec Athena. Ne sont
     listées QUE celles qu'on n'a pas déjà : rate-limit login, QFX (routé vers
     le parser OFX), multi-devise, thème sombre, Docker/Postgres sont déjà en
     place ; i18n, Sankey, comparatif mensuel, détection de récurrences et table
     FX manuelle sont déjà plus haut dans ce fichier. Écartées volontairement :
     géoloc + carte sur les transactions et multi-fuseau horaire (hors périmètre
     d'un outil mono-foyer nourri par des relevés bancaires). Ordre : du plus
     proche du cœur métier au plus périphérique. -->

**Imports — le cœur d'Athena, plus forte valeur**
- Import CAMT.053 / CAMT.052 (ISO 20022, XML SEPA) — beaucoup de banques FR/EU
  l'exportent nativement. Nouveau parser à côté de `ofx-parser.ts`, réutilise le
  dédup DB et le moteur de règles existants.
- Import MT940 (relevé SWIFT) — format texte répandu en Europe. Même pipeline.
- Import QIF — format legacy, utile pour rapatrier un vieux logiciel.
- Import depuis Firefly III / GnuCash — chemin de migration pour qui quitte un
  autre self-hosted. Plus gros chantier, priorité basse.

**Richesse des transactions**
- Sous-catégories (hiérarchie 2 niveaux) — la colonne `parentId` existe déjà en
  base (`schema.ts`) mais l'UI Categories ne l'expose pas. Petit effort, forte
  valeur.
- Pièces jointes / images sur une transaction (reçus, factures) — stockées sur
  le volume local (pas de cloud). Nouvelle table `transaction_attachments`.
- Reconnaissance de reçu (image → date/montant/marchand) — prolonge l'idée OCR
  PDF + nuextract déjà notée. Modèle self-hosted uniquement (contrainte no-cloud).
- Transactions planifiées / échéancier (loyer, salaire à venir) — dates futures
  matérialisées automatiquement. Complète la « détection de récurrences » déjà
  listée.

**Sécurité & confidentialité — dans l'esprit privacy-first**
- 2FA TOTP (app d'authentification) — optionnel par utilisateur. Le rate-limit
  login est déjà là ; le 2FA est la brique manquante.
- Verrouillage applicatif par code PIN — aujourd'hui `PrivacyContext` ne fait que
  flouter après 5 min d'inactivité ; ajouter un vrai déverrouillage (PIN) avant
  de re-révéler les montants.
- WebAuthn / passkey — variante plus forte du verrouillage, plus gros chantier.
- OIDC (auth externe) — surtout pertinent en multi-utilisateurs ; priorité basse
  pour un install LAN mono-foyer.

**Localisation & formats**
- Formats de date / nombre / devise configurables — actuellement fr-FR en dur ;
  à brancher sur `user_settings` en même temps que l'i18n déjà prévu.

**Plateforme**
- PWA installable (manifest + service worker, shell offline) — pratique pour
  consulter l'app depuis un mobile sur le LAN. Rien en place aujourd'hui.
- Image Docker multi-arch (ARM64) — le Geekom est x86 donc pas pour nous, mais
  utile aux autres une fois le projet public.

**Automatisation & intégration**
- API publique documentée + petit outil CLI — pour scripter imports/exports en
  homelab.
- Serveur MCP exposant les données à un agent IA local — niche mais raccord avec
  l'écosystème du projet ; strictement local.

### 🔍 Inspirations Actual Budget + Firefly III (audit 2026-07-08)

<!-- Comparaison de actualbudget.org/#features et firefly-iii.org avec Athena. Ne
     sont listées QUE les features qu'on n'a pas déjà, ni ici ni plus haut. Déjà
     couvert (donc écarté) : moteur de règles, splits, multi-devise + table FX
     manuelle, thème sombre, imports fichiers (OFX/CSV/PDF/QIF/CAMT), migration
     Firefly/GnuCash, transactions récurrentes + échéancier, budget mensuel par
     catégorie, comparatif mensuel, undo, API publique + CLI, rapports
     solde/timeseries/catégories. Écartées volontairement (voir bas de section).
     Ordre : du plus proche du cœur métier au plus périphérique. -->

**Budgétisation — le grand manque vs les deux outils**
- Budgétisation par enveloppes (façon Actual / YNAB) : allouer chaque euro à une
  enveloppe catégorie en début de mois, reporter le reliquat au mois suivant.
  Plus ambitieux que la simple limite mensuelle, et un vrai changement de posture
  (Athena aujourd'hui = suivi rétrospectif des relevés, l'enveloppe = prospectif).
  À trancher : est-ce cohérent avec un outil nourri après coup par les banques ?
  Promu en suivi concret (voir "Envelopes" sous 📌 Pour plus tard) une fois
  Budgets v2 (limites mensuelles/annuelles) livré.
- Tirelires / objectifs d'épargne (piggy banks, Firefly III) : cible d'épargne
  rattachée à un compte, avec barre de progression et échéance optionnelle.
  Autonome, s'aligne bien avec la contrainte no-cloud. Effort moyen.

**Rapports**
- Générateur de rapports personnalisés (façon Actual) : choisir dimensions,
  regroupement, plage, et sauvegarder la vue. Les rapports actuels sont figés ;
  celui-ci les rend composables. Gros chantier, priorité basse.

**Migration**
- Import YNAB4 / nYNAB : chemin de reprise pour qui vient de YNAB (Actual le fait
  déjà). Rejoint le cluster d'imports migration (Firefly/GnuCash) déjà noté.
  Priorité basse.

<!-- Écartées volontairement :
     - Bank syncing (GoCardless / SimpleFIN / Nordigen) : tous passent par un
       agrégateur cloud → viole la contrainte no-cloud. Hors périmètre.
     - Chiffrement bout-en-bout vers un serveur de sync (Actual) : Actual en a
       besoin car il synchronise via un serveur ; Athena est LAN-only mono-foyer
       avec la donnée dans son propre Postgres — le modèle de menace ne s'applique
       pas. Le verrou PIN / 2FA déjà listés couvrent le risque local réel.
     - Sync multi-appareils : les navigateurs du LAN tapent directement le serveur
       Athena, pas de base locale par appareil à réconcilier. Sans objet. -->

## 📌 Pour plus tard (committed)

<!-- Idées promues, à faire dans les prochaines itérations. Une ligne par item, ajouter
     une courte note si le contexte n'est pas évident. -->

- Renommer un template PDF depuis le panneau — endpoint `PUT` déjà là.
- Édition d'un template sans re-upload — plus grand, mais résout une vraie
  friction (chaque changement d'ancre = delete + re-import aujourd'hui).
- Prévisualisation d'une règle (transactions passées qu'elle aurait matché).

### Envelopes (Actual Budget-style, separate menu entry)

New page + schema, deferred from Budgets v2. Zero-based / "assign every euro"
mental model with rollover and move-money-between-envelopes actions. Spec
required before implementation. Estimated large.

## 🚧 En cours

<!-- Ce sur quoi vous travaillez maintenant. Vide la plupart du temps. -->

-

## ✅ Fait

<!-- Pour mémoire ou pour s'auto-féliciter. Les vieux items peuvent être archivés
     en bas du fichier ou supprimés. -->

- **Preview wizard PDF** : bouton « Aperçu » à l'étape Montant qui
  extrait les transactions via un nouvel endpoint
  `POST /api/imports/pdf/templates/preview` (idempotent, aucun
  side-effect) et les affiche dans un panneau scrollable. Le preview
  se réinitialise dès qu'une zone est modifiée pour éviter d'afficher
  un rendu stale. Guarde aussi contre les réponses arrivées après un
  re-paint (race in-flight) via un ref de request-id.
- **Recherche full-text** : l'endpoint `GET /api/transactions?search=`
  matche désormais `raw_label`, `normalized_label`, `memo` et `notes`
  (auparavant seulement `normalized_label`). Toujours accent- et
  case-insensitive via `immutable_unaccent(lower(…))`. Pas de
  migration — v1 basé sur OR de LIKE, adéquat au scale homelab.
- **Transaction splits (ventilation)** : nouvelle table
  `transaction_splits` avec somme forcée = parent.amount via trigger
  deferrable côté DB. Éditeur intégré à `TransactionModal`, badge
  `Ventilée (N)` + sous-lignes développables sur la liste. Migration
  `0014`. Backup v2 emporte les splits. Non fait : rules qui produisent
  des splits automatiquement (spec séparée).
- **Réglages utilisateur** : table `user_settings` (JSONB par utilisateur),
  `GET`/`PATCH /api/settings`, hook `useSettings`, page Réglages accessible
  depuis l'icône engrenage dans la barre latérale. Défauts persistés :
  période du dashboard, compte du graphique, seuil de ligne pointillée,
  seuil de similarité des doublons.
- **Filtres dashboard** : section dédiée au-dessus du graphique groupant le
  sélecteur de compte + le RangePicker. Le donut suit désormais le compte
  sélectionné.
- **Balance chart** :
  - Axe X calendaire (avant : basé sur l'index bucket) — les points de
    contrôle et les segments pointillés s'affichent maintenant à la bonne
    position temporelle.
  - Zoom par brush (glisser sur la zone du graphique) + bouton
    "Réinitialiser le zoom" en haut à droite.
  - Segments pointillés au-dessus d'un seuil configurable (Réglages),
    couleur ambre pour la dérive checkpoint.
- **Templates PDF — filtrage par contenu** : dérivation automatique du
  `pageAnchor` (ligne d'en-tête de compte) + `otherAnchors` (marqueurs
  d'autres comptes) au moment de la sauvegarde. Fallback fréquence quand
  toutes les pages sont cochées. Matching flat-text à l'import pour
  survivre à la fragmentation pdfjs. Fallback `n°<digits>` quand la
  banque change le wording marketing entre relevés. Sélecteur manuel
  "Le mien" / "Autre compte" dans le wizard avec auto-marquage des
  autres candidats. Coupure au milieu de page quand un autre compte
  commence. Panneau diagnostic "Voir le texte extrait" pour debug.
- **Templates PDF — auto-recovery** : quand un template sauvegardé ne
  produit plus de lignes, ré-ouverture automatique du wizard avec une
  bannière diagnostique au lieu du 422 "retrain via /api/pdf-templates".
- **Templates PDF — panneau de gestion** : nouvelle section
  "Templates PDF" en bas de la page Imports, listant chaque template
  avec son ancre stockée, ses marqueurs de coupure, son mode de
  filtrage (contenu vs numéro absolu), et un bouton Supprimer.
- **Points de contrôle** : messages d'erreur explicites (400/404/409)
  au lieu de "invalid input". Toujours en cours : édition de la date
  d'un checkpoint (backend `PATCH` accepte encore uniquement montant +
  note).
- **Backup export/import** : ajout des points de contrôle par compte,
  suppression de `transferRules` (obsolète depuis `is_internal_transfer`
  sur les catégories). Historique restauré tel quel pour compat.
- **Import PDF** : affichage des transactions "lues mais dédupliquées"
  dans le résumé du wizard (avant : simple compteur).
- **Possibles doublons** : bouton "↻ Rafraîchir" + refetch on focus +
  invalidation après un import wizard PDF.
- Bulk-select + bulk-delete on the Transactions list (row checkboxes,
  indeterminate header checkbox, action bar + confirm dialog, backend
  `POST /api/transactions/delete-bulk` with the transfer-leg unlink
  guard). `Transactions/*`, `transactions.ts`.
- Folder / multi-file upload — the import form accepts a folder pick or
  a Cmd/Ctrl multi-select and processes files sequentially, with a
  progress card and a summary of inserted / skipped / needs-template /
  errored. Single-file behavior unchanged. `Imports/UploadForm.tsx`.
- Bulk-select on the Possibles doublons panel — per-row checkboxes +
  action bar with "Pas un doublon" and "Supprimer".
  `Imports/DuplicatesPanel.tsx`.
- Available vs blocked money on locked accounts (PEA / dépôt à terme).
  Accounts and transactions carry a `lock_years` column; the Dashboard
  hero switches to "Disponible" with a "+ X€ bloqués" tag when a lock
  is unmatured, and each account card shows the split. Migration 0011.
- Dashboard balance-chart account selector persisted to localStorage —
  the last account you were watching stays selected across reloads
  (superseded by the `dashboard.chartScope` setting).
- Colored kind badges for categories (expense / income / neutral, light
  tones) + retired the `transfer` kind (internal transfers are already
  tracked via `transfer_group_id`). Migration 0010 coerces old rows.
- Drag-to-reorder on the Accounts page (replaces the ↑/↓ arrow buttons;
  @dnd-kit, keyboard + touch accessible).
- Sidebar user-profile block pinned to the bottom of the left panel on
  desktop.
- Fix: balance checkpoints mispositioned on the Dashboard chart (was
  interpolating by whole-range time fraction instead of bucket index —
  could drift by several months when buckets are spaced irregularly).
- Fix: "Devise" (EUR) label rendering below the previous field instead
  of aligned, in the account edit form.
- Points de contrôle par compte affichés sur le graphique Dashboard
  (drift vs. cumul calculé, tolérance 1 centime).
- CI GitHub Actions + rapport de couverture Codecov (backend vitest,
  service Postgres 16, badges dans le README).
- Frontend test harness (Vitest + Testing Library + jsdom) + first
  refactor+test iteration on Accounts.tsx.
- **Budgets** : `category_budgets` table (migration 0015), `/api/budgets`
  CRUD endpoints with 409/400 rules, `/api/reports/budget` for
  planned-vs-actual, and a dedicated Budgets page with month picker,
  per-category bars, and red overflow indicator.
- **Budgets v2** : plafonds mensuels **ou annuels** (`period` sur
  `category_budgets`), scope optionnel par compte. `/api/reports/budget`
  expose désormais `windowDays`/`elapsedDays`, une projection de fin de
  période, un historique 6-périodes par catégorie, une détection
  d'anomalie, une suggestion de plafond (moyenne historique quand le
  dépassement est chronique) et les `unbudgetedCandidates` (catégories
  sans plafond parmi les plus dépensières). Page Budgets refaite :
  sélecteur Mois/Année avec état dans l'URL, filtre de compte,
  SummaryCard (totaux + mini-graphe 6 périodes, rollup-aware pour éviter
  le double-compte parent/enfant), lignes avec sparkline + pastille
  anomalie, carte de suggestion (Ignorer / Ajuster à X€, dismissal
  scopé par période via localStorage), section "Catégories sans budget"
  avec pré-remplissage du formulaire d'ajout, et formulaire d'ajout avec
  choix période + compte.
- **OCR pour les PDF scannés + photos de relevés papier** : nouveau
  module `imports/ocr` basé sur `tesseract.js` côté serveur (fra+eng,
  `OCR_LANG_PATH` env var pour déploiement LAN-only). Job async lancé
  via `queueMicrotask` sur upload d'un PDF sans couche texte —
  transitions `not_needed` / `pending` / `ready` / `error` exposées via
  `GET /api/imports/pdf/drafts/:id/ocr-status` (polling depuis un
  nouveau step `<OcrProgress>` dans le wizard). Nouveau chemin photo :
  `POST /api/imports/photo` accepte JPEG/PNG/WebP/HEIC (25 Mo max,
  transcodage HEIC via `sharp`, MIME sniffé par magic-bytes), même
  wizard, même flux OCR. `PreviewTable` composant partagé
  `editable=true|false` : les lignes OCR sont éditables avant import
  avec pastilles de confiance (vert ≥ 85%, orange 65-84%, rouge <65%)
  et bouton × pour supprimer une ligne parasite ; l'import final poste
  `override_rows` qui bypasse `parseStatementRows`. Migration 0020
  ajoute `source_kind`, `ocr_status`, `ocr_progress`, `ocr_total`,
  `ocr_error` sur `pdf_import_drafts`. Ownership check ajouté sur
  `applyTemplateAndImport` (parité avec `previewTemplate`) — `override_rows`
  rendait le trou pré-existant exploitable en cross-user.
- **Sous-catégories (hiérarchie 2 niveaux)** : `parent_id` désormais
  exploité de bout en bout. Migration 0019 (index unique
  `(user_id, COALESCE(parent_id, 0), name)`), invariants serveur (cap
  2 niveaux, héritage du `kind`, coercion à la mise en place d'un
  parent, cascade à la mutation du `kind` d'un parent, cycle
  prevention). Page Catégories groupée (parent + enfants indentés) +
  sélecteur Parent. Format `Parent › Leaf` partout où une catégorie
  apparaît en ligne (Transactions, modales, splits, Tri, Doublons,
  filtres, Règles). Budgets : `/api/reports/budget` roule sur les
  descendants ; page Budgets groupée + correction du total agrégé
  quand parent + enfant sont tous deux budgétés. Insights : le
  classement des plus grosses variations remonte à la racine.
  Sauvegarde v4 : chaque référence en aval (rules, transactions,
  splits, budgets) porte un `categoryParent` optionnel ; restore
  topologique + `resolveCategoryRef` (chemin puis fallback nom seul).
- **Panneau Insights sur le Dashboard** : section mensuelle (revenus,
  dépenses, épargne, catégorie dominante) avec month stepper. Les
  revenus ne comptent que les catégories `kind = income` pour éviter
  de gonfler le total avec des transferts internes.
- **Sankey cash-flow sur le Dashboard** : diagramme SVG maison (rubans
  pleins, hover, header aligné avec Insights via suffix + arrow chip)
  reliant revenus → catégories de dépense. Partage le cache
  `/api/reports/categories` avec le donut.
- **Nettoyage sélecteur/explainer d'import** : suppression du
  paragraphe "À l'import, le compte cible est déduit du nom du
  fichier…" sur la section Motifs et remplacement du placeholder
  "Auto (via nom du fichier)" par "—" dans le sélecteur de compte à
  l'import.

---

### Notes / réflexions plus longues

<!-- Réflexions multi-lignes qui ne tiennent pas en une puce. Utiliser des sous-titres
     `###` ou `####` si une note grossit, et la promouvoir éventuellement en plan
     dans `docs/superpowers/specs/` si elle devient une vraie fonctionnalité. -->

#### Sur le filtrage PDF multi-comptes

L'itération de cette semaine a montré que la dérivation automatique des
ancres est vraiment délicate quand :

- Toutes les pages sont cochées (fallback fréquence maintenant en place).
- La banque reformule l'en-tête d'un mois à l'autre (fallback
  `n°<digits>` en place).
- pdfjs fragmente une ligne visuelle en deux items (flat-text scan en
  place).

Le sélecteur manuel "Le mien / Autre compte" existe désormais pour les
cas résiduels. Prochain palier : permettre à l'utilisateur de **peindre
la ligne d'ancrage directement sur le canvas rendu** plutôt que de la
choisir dans une liste — plus intuitif si le PDF a beaucoup de lignes
similaires (comptes multiples de la même banque avec un numéro qui ne
diffère que sur les derniers chiffres).

#### Sur les tests d'intégration DB

Actuellement `describe.skipIf(!RUN_DB_TESTS)` sur tout ce qui touche
Postgres. Ça marche pour la CI GitHub Actions (qui a un service
Postgres 16) mais localement il n'y a rien qui tourne — le déploiement
est LAN-only sans container en dev. Alternatives :

1. Un docker-compose spécifique `docker-compose.test.yml` qui lance
   uniquement Postgres pour les tests locaux.
2. `testcontainers` (Node) qui provisionne un Postgres jetable par run.
   Ajoute une dépendance mais élimine le gate manuel.
3. Rester sur le gate — la CI attrape les régressions, le local reste
   rapide.

À trancher quand un test DB pète en CI sans qu'on l'ait vu venir en
local.
