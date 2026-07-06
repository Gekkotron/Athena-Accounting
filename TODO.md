# TODO / Idées

Brainstorming + roadmap pour Athena Accounting. Pas de structure imposée — déplacez
les éléments entre les sections au fur et à mesure que vous décidez quoi faire.

---

## 🧠 Idées (en vrac)

<!-- Tout ce qui passe par la tête, même à demi-formé. Pas obligé que ce soit clair. -->

- Traduire l'app (fr, en) avec detection de la langue du navigateur.
- check if nuextract will be useful https://about.nuextract.ai (self-hosted).
- Update readme with new features + screenshots.
- OCR pour les PDF scannés (Tesseract-node ou tesseract.js côté serveur) — le
  wizard PDF détecte déjà `no_text_layer` mais renvoie une template vide.
  Servirait pour les vieux relevés archivés.
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
- Budget mensuel par catégorie avec chip rouge quand dépassé. Table
  `category_budgets { categoryId, monthlyLimit, currency }`.
- Vue "Comparatif mensuel" : ce mois-ci vs le mois dernier par catégorie,
  avec delta et sparkline. Bâti sur `/api/reports/categories` qui expose
  déjà les mois.
- Sankey diagram sur le dashboard (revenus → dépenses par catégorie),
  D3-flavoured et intégré au design tokens du reste de l'app.
- Recherche full-text dans les libellés + notes des transactions
  (`pg_trgm` déjà installé, un `ILIKE '%...%'` sur `raw_label || memo || notes`
  suffit pour la v1 ; migration vers un `tsvector` si besoin).
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

## 📌 Pour plus tard (committed)

<!-- Idées promues, à faire dans les prochaines itérations. Une ligne par item, ajouter
     une courte note si le contexte n'est pas évident. -->

- Renommer un template PDF depuis le panneau — endpoint `PUT` déjà là.
- Édition d'un template sans re-upload — plus grand, mais résout une vraie
  friction (chaque changement d'ancre = delete + re-import aujourd'hui).
- Prévisualisation des N premières transactions dans le wizard PDF avant de
  cliquer "Importer" — fait bcp gagner sur les templates douteux.
- Prévisualisation d'une règle (transactions passées qu'elle aurait matché).
- Recherche full-text simple sur libellés/notes.

## 🚧 En cours

<!-- Ce sur quoi vous travaillez maintenant. Vide la plupart du temps. -->

-

## ✅ Fait

<!-- Pour mémoire ou pour s'auto-féliciter. Les vieux items peuvent être archivés
     en bas du fichier ou supprimés. -->

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
