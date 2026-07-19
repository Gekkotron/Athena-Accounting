---
title: Dépannage
sidebar_position: 9
---

# Dépannage

Problèmes courants et contournements. Chaque sous-section suit la même
structure : ce que vous observez, la cause, et la correction. Si le
vôtre n'apparaît pas, ouvrez une issue en précisant votre version
d'Athena, le plus petit exemple qui reproduit le problème, et les
lignes utiles de `docker compose logs` (voir
[Recueillir des diagnostics](#recueillir-des-diagnostics)).

## Démarrage

### Le port Postgres 5432 est déjà utilisé

**Symptôme.** `docker compose up` échoue avec
`bind: address already in use` sur le port `5432`, ou le service `db`
redémarre en boucle.

**Cause.** Un autre processus de l'hôte écoute déjà sur `5432` — le
plus souvent un Postgres installé via Homebrew, `postgresql.service`,
ou une autre stack compose.

**Correction.** Soit arrêter l'autre processus (`brew services stop
postgresql`, `systemctl stop postgresql`), soit supprimer complètement
le mapping de port côté hôte — le backend parle à Postgres via le
réseau compose et n'a pas besoin que `5432` soit exposé sur l'hôte.
Commentez le bloc `ports:` du service `db` dans `docker-compose.yml` ;
la stack fonctionne toujours, seul l'usage de `psql` depuis la machine
hôte cesse de fonctionner.

### Fichier `.env` manquant ou incomplet

**Symptôme.** `docker compose up` échoue avec
`error while interpolating POSTGRES_USER`, ou le conteneur backend
plante au démarrage sur `SESSION_SECRET is required`.

**Cause.** Le fichier compose lit les secrets depuis `.env` à la
racine du dépôt. Si vous avez cloné le projet sans copier
`.env.example` en `.env`, aucune variable n'est définie.

**Correction.**

```sh
cp .env.example .env
# puis éditez .env et définissez au minimum :
#   POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, SESSION_SECRET
```

`SESSION_SECRET` doit être une longue chaîne aléatoire — générez-la
avec `openssl rand -hex 32`. Redémarrez la stack :
`docker compose down && docker compose up -d`.

### Échec de migration au premier démarrage

**Symptôme.** Le conteneur `backend` s'arrête peu après que `db`
devient healthy. `docker compose logs backend` affiche une erreur de
migration Prisma ou Drizzle — typiquement
`relation "…" already exists` ou `column "…" does not exist`.

**Cause.** Le volume `postgres-data/` provient d'un schéma antérieur
incompatible (mise à jour d'Athena à travers une migration cassante,
ou base peuplée à la main).

**Correction.** Pour une installation fraîche, supprimez le volume
obsolète :

```sh
docker compose down
rm -rf ./postgres-data
docker compose up -d
```

Pour une installation existante, **ne supprimez pas le volume** —
exportez d'abord vos données (voir
[Sauvegarde et restauration](./backup-recovery)), puis effacez et
restaurez.

## Import

### Le modèle PDF ne matche plus

**Symptôme.** Un relevé qui s'importait bien le mois dernier renvoie
maintenant « 0 transaction extraite » ou « le modèle ne correspond
pas ».

**Cause.** Votre banque a modifié la mise en page de ses PDF — même un
décalage d'un pixel sur une colonne ou un en-tête renommé casse
l'extracteur à base de regex. C'est de loin l'échec d'import le plus
fréquent.

**Correction.** Ouvrez **Réglages → Import → Modèles**, choisissez le
modèle du compte concerné, et relancez « auto-détecter depuis un
échantillon » avec le nouveau PDF. Si la mise en page a peu changé,
éditer les ancres de colonnes à la main est en général plus rapide
que de repartir de zéro. Voir [Importer](./importing) pour une
procédure guidée.

### Le fichier OFX s'importe en charabia

**Symptôme.** Les transactions arrivent, mais les libellés sont pleins
de `?` ou les caractères accentués sont mal décodés (`Ã©` au lieu
de `é`).

**Cause.** Les banques françaises et belges produisent souvent des OFX
en `ISO-8859-1` (ou `windows-1252`), alors que l'en-tête OFX 1.x
déclare `UTF-8` — ou ne déclare rien du tout. Athena lit en UTF-8 par
défaut et retombe sur Latin-1 quand il détecte des séquences UTF-8
invalides, mais un fichier à encodage mixte peut passer entre les
mailles.

**Correction.** Réencodez le fichier avant l'import :

```sh
iconv -f WINDOWS-1252 -t UTF-8 releve.ofx > releve-utf8.ofx
```

Puis ré-importez `releve-utf8.ofx`. Si votre banque produit
systématiquement des fichiers en Latin-1, marquez le compte dans
**Réglages → Import → Avancé** pour forcer le décodage
`windows-1252` sur chaque import de cette source.

### Les colonnes CSV ne correspondent pas

**Symptôme.** L'assistant d'import CSV propose un mapping incorrect
(la date dans le champ montant, ou toute la ligne sur une seule
colonne).

**Cause.** Deux variantes fréquentes : le fichier utilise `;` comme
séparateur (export banque française) alors qu'Athena a deviné `,`, ou
il comporte une ligne d'en-tête en prose au-dessus des vrais titres de
colonnes.

**Correction.** Dans l'assistant, changez explicitement le séparateur
(`;`, `,`, `\t`) et réglez « Ligne d'en-tête » sur le bon numéro de
ligne. Enregistrez ce mapping comme modèle sur le compte pour que
l'import suivant depuis la même banque le détecte automatiquement. Si
le fichier est fondamentalement mal formé (séparateurs mélangés,
virgules non échappées dans les libellés), ouvrez-le dans un éditeur
de texte et nettoyez-le avant import — Athena ne fera pas de
supposition silencieuse dans ce cas.

## Écart de solde

Vous avez rapproché le mois dernier, et ce mois-ci le solde calculé
ne correspond plus au solde officiel de la banque. Trois causes
expliquent presque tous les écarts.

### Une transaction manque

**Symptôme.** Le solde Athena est inférieur (ou supérieur) au solde
banque d'exactement le montant d'une transaction.

**Cause.** Un relevé couvrait une période partielle, et une
transaction se trouvait à la frontière de deux fichiers — soit pas
importée du tout, soit importée deux fois avec un seul des deux
doublons supprimé lors de la déduplication.

**Correction.** Filtrez le compte sur la plage de dates litigieuse et
comparez ligne à ligne avec le PDF du relevé. Ajoutez la ligne
manquante via **+ Nouvelle transaction**, ou supprimez le doublon.
Relancez ensuite **Réglages → Solde → Vérifier** pour confirmer que
les deux chiffres coïncident.

### Un doublon n'a pas été fusionné

**Symptôme.** La même transaction apparaît deux fois, une fois depuis
un import OFX et une fois depuis un import PDF (ou une fois depuis
chacun de deux relevés qui se chevauchent).

**Cause.** La déduplication compare date, montant et libellé
normalisé. Si les deux sources produisent des libellés légèrement
différents (par exemple `CB CARREFOUR 12/03` vs `PAIEMENT CARTE
CARREFOUR`), l'empreinte ne correspond pas et le second exemplaire
est conservé.

**Correction.** Ouvrez **Transactions**, triez par date, repérez la
paire, et supprimez celle qui vient de la source la moins fiable
(en général le PDF — les libellés OFX sont plus consistants). Pour
éviter la récidive, ajoutez une règle de normalisation dans
**Réglages → Règles** qui réécrit les deux libellés vers la même
forme canonique avant la déduplication.

### Dérive de checkpoint

**Symptôme.** L'écart est faible (quelques euros ou centimes) et
présent depuis une date bien précise.

**Cause.** Un **checkpoint** — l'ancre « au JJ/MM/AAAA, la banque
indique un solde de X » qu'Athena utilise comme source de vérité — a
été saisi avec la mauvaise valeur, ou des transactions antérieures
ont été modifiées après sa création. Chaque solde affiché vaut
`checkpoint + somme des transactions postérieures au checkpoint` ;
un checkpoint erroné décale donc tout ce qui vient après.

**Correction.** Ouvrez **Réglages → Compte → Checkpoints**, supprimez
le checkpoint dérivé, et re-saisissez-le avec la valeur d'un relevé
banque dont la date vous inspire confiance. Si plusieurs checkpoints
sont faux, ne gardez que le plus ancien correct — Athena recalcule à
partir de là.

## Erreurs de sauvegarde et de restauration

### « Version de sauvegarde non supportée »

**Symptôme.** La restauration échoue immédiatement avec
`unsupported backup version: v5 (this build supports up to v4)`.

**Cause.** L'export a été produit par une version d'Athena plus
récente que celle sur laquelle vous restaurez. Athena refuse d'ouvrir
un fichier de version supérieure — rétrograder un schéma n'est pas
sûr, c'est un refus volontaire.

**Correction.** Mettez à jour l'installation cible (`git pull &&
docker compose up -d --build`, ou mise à jour de l'application
bureau) jusqu'à atteindre la version qui a produit le fichier.
Relancez ensuite la restauration.

### La restauration se bloque puis fait un rollback

**Symptôme.** La restauration tourne pendant une minute, puis l'UI
affiche « restauration échouée, aucune donnée modifiée ».
`docker compose logs backend` montre un rollback de transaction.

**Cause.** La restauration prend un lock transactionnel sur les
lignes de l'utilisateur courant. Un second client (un autre onglet,
ou un import en cours en arrière-plan) détient un lock au niveau
ligne et la restauration expire en attendant.

**Correction.** Fermez tous les autres onglets Athena et annulez
l'import en cours, puis réessayez. La restauration est idempotente —
la tentative échouée n'a laissé aucun état partiel, grâce au rollback.

### `athena.db` est corrompu (application bureau)

**Symptôme.** L'application bureau plante au lancement avec
`PGlite: database is malformed`, ou l'UI s'ouvre sur un état vide
alors que vous aviez déjà importé des données.

**Cause.** Le fichier PGlite a été écrit pendant que le système
s'arrêtait, ou un antivirus l'a mis en quarantaine en cours
d'écriture.

**Correction.** Renommez le fichier plutôt que de le supprimer :

```sh
# macOS
mv "~/Library/Application Support/Athena Accounting/athena.db" \
   "~/Library/Application Support/Athena Accounting/athena.db.corrupt"
```

Relancez l'application, passez par l'onboarding, puis utilisez
**Réglages → Données → Restaurer** avec votre dernier export.
Conservez le fichier `.corrupt` jusqu'à avoir vérifié la
restauration — c'est votre source de récupération de dernier recours.

## Catégorisation et règles

### Une règle ne matche plus les nouvelles transactions

**Symptôme.** Une règle qui a fonctionné pendant des mois manque
soudain les nouvelles transactions du même émetteur. Leur catégorie
reste vide dans **Transactions** et elles atterrissent dans la file
d'attente Tri.

**Cause.** Votre banque a modifié le format du libellé — un préfixe a
bougé, un code marchand a changé, ou un importeur OFX conserve
maintenant une balise brute qu'un import PDF supprimait. Les règles
matchent contre le libellé *normalisé*, donc même un petit changement
casse le match.

**Correction.** Ouvrez **Règles → Tri**, trouvez une des lignes mal
catégorisées et cliquez sur **« règle depuis cette transaction »** —
le formulaire se pré-remplit avec le libellé normalisé actuel pour
que vous puissiez élargir le matcher (par ex. passer d'un
`startsWith` à un `contains`, ou accepter un suffixe optionnel).
Supprimez l'ancienne règle une fois que la nouvelle couvre le même
périmètre.

### La même transaction est re-catégorisée à chaque fois

**Symptôme.** Vous modifiez à la main la catégorie d'une transaction,
vous enregistrez, et le lendemain elle est revenue à la « mauvaise »
catégorie — de façon reproductible.

**Cause.** Une règle oubliée matche ce libellé et s'applique à chaque
passe de catégorisation, écrasant votre édition manuelle. Une
catégorie posée à la main sur une transaction qu'une règle matche
aussi est traitée comme « plus faible » que la règle.

**Correction.** Dans **Règles → Règles**, filtrez sur un fragment du
libellé ; la règle en cause apparaît en tête. Soit vous la restreignez
(bande de montants, préfixe de code banque, exclusion), soit vous la
supprimez et créez une règle plus spécifique. Si vous voulez que
votre édition manuelle prime, promouvez-la en règle — elle gagnera
alors sur tout matcher plus large.

### Renommer une catégorie laisse les vieilles transactions sur l'ancien nom

**Symptôme.** Vous renommez `Courses` → `Alimentation` dans l'arbre
des catégories, mais les transactions importées avant le renommage
affichent encore `Courses` dans les exports, et le tableau de bord
sépare la part camembert en deux tranches.

**Cause.** Les catégories sont stockées par id, pas par nom — un
renommage met donc à jour les références futures correctement, mais
certaines vues en cache peuvent traîner tant que les mois affectés ne
sont pas re-agrégés.

**Correction.** Provoquez un rendu neuf : changez la plage du tableau
de bord vers un autre mois puis revenez, ou rechargez la page. Si les
deux tranches persistent, vous avez en fait deux ids de catégorie
distincts — fusionnez-les depuis **Règles → Catégories** (glissez
l'une sur l'autre).

## Budgets et enveloppes

### Une enveloppe dépasse du montant d'un virement

**Symptôme.** Votre enveloppe `Loyer` devrait être pile à la cible ce
mois-ci, mais la page budget la montre en dépassement du montant
exact d'un virement entre deux de vos comptes.

**Cause.** La jambe du virement n'a pas été taggée comme virement
interne à l'import, elle est donc encore catégorisée comme une sortie
normale et compte contre le plafond de l'enveloppe.

**Correction.** Ouvrez la transaction, cliquez sur **« marquer comme
virement interne »**, et choisissez le compte contrepartie.
L'enveloppe se recalcule ; la paire est exclue des totaux budgétaires
à partir de ce moment. Pour éviter que cela se répète, ajoutez une
**règle de virement** correspondant au libellé et à la direction
(voir [API endpoints](../reference/api-endpoints) → Transfer rules).

### Une catégorie que j'utilise chaque mois n'apparaît pas dans le budget

**Symptôme.** Vous voyez une catégorie sur le tableau de bord, mais
la page Plafonds ne la liste pas — impossible de la plafonner.

**Cause.** La vue budget ne montre que les catégories ayant au moins
un plafond défini (passé ou présent). Une catégorie toute neuve qui
n'a jamais eu de plafond est invisible tant que vous ne lui en
ajoutez pas un.

**Correction.** Ouvrez **Budgets → Plafonds**, cliquez sur **+ Ajouter
un plafond**, sélectionnez la catégorie, et posez un plafond (même
un placeholder à 0 fonctionne — la ligne apparaîtra sur les mois
suivants et vous pourrez l'ajuster).

### Le report du mois dernier ne s'est pas fait

**Symptôme.** Vous aviez un solde positif dans une enveloppe en fin
de mois, vous vous attendiez à ce qu'il se reporte, mais le nouveau
mois démarre à zéro.

**Cause.** Le report est par enveloppe, pas par catégorie, et il est
désactivé par défaut sur les enveloppes nouvellement créées. Les
catégories qui n'ont qu'un plafond (sans enveloppe) ne reportent
jamais — c'est un plafond, pas une caisse d'épargne.

**Correction.** Ouvrez **Budgets → Enveloppes**, éditez l'enveloppe,
et activez **« reporter le solde »**. Le solde d'ouverture du mois
suivant inclura le reliquat du mois précédent. Pour rattraper *ce*
mois-ci, ajoutez une entrée d'ajustement ponctuelle dans l'enveloppe
pour le montant manquant.

## Récurrent et prévision

### La page Prévision indique « aucune série confirmée »

**Symptôme.** Vous ouvrez **Récurrent → Prévision** et vous voyez un
état vide qui vous demande de confirmer d'abord vos séries, alors
même que l'onglet Détectés en liste plusieurs.

**Cause.** La prévision ne projette que les séries **confirmées**,
par conception — une détection non confirmée est une supposition, et
laisser des suppositions piloter une courbe de solde à 6 mois produit
des projections trompeuses. C'est le comportement par défaut, pas un
bug.

**Correction.** Ouvrez **Récurrent → Détectés**, passez les lignes en
revue, et cliquez sur **Confirmer** sur celles qui sont de vraies
séries récurrentes. La prévision les prend en compte immédiatement.
Si vous voulez *tout de même* la vue incluant les suppositions pour
un contrôle rapide, activez **« inclure les séries détectées »**
directement sur la page Prévision — une case à cocher apparaît quand
seules des séries détectées existent.

### Une facture mensuelle n'apparaît pas dans Détectés

**Symptôme.** Vous payez le même abonnement chaque mois, mais Athena
ne l'a jamais fait remonter dans **Récurrent → Détectés**.

**Cause.** Le détecteur exige au moins trois occurrences avec un
libellé stable *et* une cadence régulière. Si le montant varie
beaucoup (une facture d'utilité à prix variable), ou si le libellé
change entre les prélèvements (certains processeurs de carte font
tourner un suffixe), le détecteur ignore la série.

**Correction.** Ajoutez la série à la main : **Récurrent → Détectés
→ + Ajouter une série**, choisissez le compte, un motif de libellé,
une bande de montants, et une cadence. Confirmez-la et elle commence
à alimenter À venir et Prévision au prochain tick.

### À venir affiche la même facture deux fois ce mois-ci

**Symptôme.** **Récurrent → À venir** liste deux entrées pour la même
série récurrente dans le mois courant.

**Cause.** Le mois couvre une période « longue » entre deux
occurrences d'une cadence bi-mensuelle ou de 28 jours, si bien que
deux paiements tombent réellement dans le même mois calendaire — ce
comportement est correct, pas un doublon. Autre cas : un paiement
ponctuel à la même date que l'occurrence projetée a été inclus dans
la liste À venir.

**Correction.** Vérifiez les dates. Si les deux sont de vraies
occurrences de cadence, laissez-les. Si l'une est un paiement
ponctuel que vous ne voulez pas projeter, éditez la série et fixez
sa **prochaine occurrence** à la date correcte — le doublon disparaît.

## Accès MCP

### Les outils n'apparaissent pas dans le client

**Symptôme.** Vous avez branché le serveur MCP `athena` dans la
config de votre client, redémarré le client, et les six outils Athena
(`search_transactions`, `create_transaction`, …) ne s'affichent
toujours pas.

**Cause.** Soit le chemin `command`/`args` de la config client ne
pointe pas vers un module `mcp/` construit, soit le module est là
mais n'a pas été rebuilt après une mise à jour (pas de `dist/`), soit
le client n'a pas relu sa config.

**Correction.** Dans le repo, exécutez `cd mcp && npm install && npm
run build`. Vérifiez que le `command` de la config client pointe vers
l'entrée buildée (habituellement un chemin absolu vers
`mcp/dist/index.js`). Quittez complètement puis relancez le client —
un simple redémarrage à chaud ne suffit pas pour la plupart des
clients MCP.

### Chaque appel d'outil renvoie « unauthorized »

**Symptôme.** Les outils apparaissent dans le client, mais tout
appel échoue avec `unauthorized` ou `invalid token`.

**Cause.** Le `ATHENA_MCP_TOKEN` dans la config client est vide,
tronqué au collage, ou a été régénéré dans Athena sans être mis à
jour côté client.

**Correction.** Dans Athena, ouvrez **Réglages → MCP**, révoquez et
régénérez le token, copiez-le en entier (ils sont longs — attention à
la coupure de ligne du terminal), collez-le dans la config client,
redémarrez le client. Vérifiez aussi que `ATHENA_MCP_USER` correspond
exactement à votre nom d'utilisateur de connexion (la casse compte).

### `reconcile_statement` signale que le chemin du PDF n'est pas lisible

**Symptôme.** Tous les autres outils MCP fonctionnent, mais
`reconcile_statement` échoue avec `path not readable` ou `no such
file`.

**Cause.** Les outils MCP tournent dans le processus du client, donc
les chemins relatifs se résolvent contre le répertoire de travail *du
client* — rarement là où vos relevés sont stockés. Passer un simple
nom de fichier échoue tant que `ATHENA_STATEMENTS_DIR` n'est pas
défini.

**Correction.** Soit passez un chemin absolu vers le PDF, soit
définissez `ATHENA_STATEMENTS_DIR` dans le bloc `env` du client
pointant vers le dossier où vivent vos relevés — un simple nom de
fichier se résoudra alors contre ce dossier. Voir
[Accès MCP](./mcp) pour la forme complète de la config.

## Connexion et session

### « Session expirée » à chaque réouverture de l'application

**Symptôme.** Vous vous connectez, travaillez une minute, fermez
l'onglet ou la fenêtre ; en revenant vous êtes immédiatement renvoyé
sur l'écran de connexion.

**Cause.** Soit le navigateur refuse de stocker le cookie de session
(navigation privée, blocage des cookies tiers sur une config à
sous-domaines), soit `SESSION_SECRET` a changé entre le moment de la
connexion et maintenant (par ex. la stack a été relancée avec une
valeur regénérée), ce qui invalide tous les cookies déjà émis.

**Correction.** Utilisez une fenêtre normale (pas de navigation
privée). Si vous êtes derrière un reverse-proxy, assurez-vous qu'il
ne supprime ni ne réécrit l'en-tête `Set-Cookie`. Vérifiez que
`SESSION_SECRET` dans `.env` est stable d'un redémarrage à l'autre —
ne le régénérez jamais après la configuration initiale, sauf pour
déconnecter tout le monde volontairement.

### Un install fraîchement fait refuse tous les identifiants

**Symptôme.** Sur une installation neuve, la page de login rejette
tout ce que vous essayez, et il n'y a pas de lien d'inscription
visible.

**Cause.** Athena est mono-utilisateur par installation et n'expose
pas d'inscription publique. Le premier utilisateur doit être seedé
— soit par le flux d'onboarding de l'application desktop, soit sur
Docker via la commande de première exécution du backend.

**Correction.** Desktop : rouvrez l'application jusqu'à l'écran
d'onboarding. Docker : suivez les instructions de configuration
dans [Démarrer](./getting-started) → *Créer le premier utilisateur*.
Si vous avez déjà terminé l'onboarding mais avez oublié votre mot de
passe, la seule solution est une réinitialisation au niveau base de
données (il n'y a pas de flux de reset par e-mail, par conception —
pas de serveur SMTP, pas de dépendance externe).

## Mises à jour de l'application desktop

### Gatekeeper macOS bloque le premier lancement

**Symptôme.** Double-cliquer sur le `.dmg` ou l'`.app` téléchargé
produit une boîte de dialogue du style *« Athena Accounting ne peut
pas être ouvert car Apple ne peut pas vérifier qu'il ne contient pas
de logiciel malveillant »*.

**Cause.** Le build est signé mais pas notarisé pour toutes les
versions de macOS, ou Gatekeeper est particulièrement méfiant vis-à-
vis d'un certificat de signature récent.

**Correction.** Clic droit sur l'icône → **Ouvrir** (pas de
double-clic) — ce chemin fait apparaître une boîte « Ouvrir quand
même » qui n'apparaît pas au double-clic. Alternative : **Réglages
Système → Confidentialité et sécurité**, descendez jusqu'au message
« Athena Accounting a été bloqué… », cliquez sur **Ouvrir quand
même**.

### L'application ne démarre plus après une mise à jour

**Symptôme.** L'application s'est mise à jour silencieusement pendant
la nuit ; aujourd'hui elle rebondit dans le Dock (macOS) ou le
processus démarre et quitte immédiatement (Windows/Linux), sans
fenêtre visible.

**Cause.** Une instance précédente détient encore le fichier de base
PGlite, ou l'updater n'a pas pu terminer l'écrasement d'une
ressource.

**Correction.** Forcez la fermeture de toutes les instances en cours
d'exécution (macOS : `⌘⌥⎋` → Athena Accounting → Forcer à quitter ;
Windows : Gestionnaire de tâches → Fin de tâche sur chaque processus
Athena). Relancez. Si le crash se répète, suivez
[`athena.db` est corrompu](#athenadb-est-corrompu-application-bureau) — le
fichier a peut-être été laissé en écriture par la mise à jour.

### L'auto-update reste bloqué sur « Téléchargement… »

**Symptôme.** L'updater indique qu'une nouvelle version est en cours
de téléchargement, mais la barre ne bouge pas, ou il retente en
boucle.

**Cause.** Le CDN GitHub Releases est momentanément injoignable, ou
un proxy d'entreprise / VPN intercepte la connexion avec un
certificat auquel l'updater ne fait pas confiance.

**Correction.** Annulez la mise à jour dans l'application, téléchargez
le dernier installeur directement depuis
[GitHub Releases](https://github.com/Gekkotron/Athena-Accounting/releases),
et installez par-dessus la version courante — vos données locales
sont conservées.

## Performances

### Le tableau de bord met plusieurs secondes à s'afficher

**Symptôme.** Ouvrir le tableau de bord sur la plage « année en
cours » prend visiblement du temps — 3 à 10 secondes — après que
votre table de transactions a dépassé ~50 000 lignes.

**Cause.** Les widgets les plus lourds (Sankey, ventilation par
catégorie, séries temporelles) tirent chacun leur propre agrégat.
Sur une plage large avec un gros historique, les requêtes d'agrégats
dominent.

**Correction.** Réduisez la plage par défaut au trimestre en cours —
la plupart des utilisateurs ne regardent pas plus loin au quotidien.
Si vous avez régulièrement besoin de la vue annuelle, épinglez-la
dans l'onglet Rapports, et pré-chauffez le cache en l'ouvrant une
fois en début de journée.

### L'import est lent sur un gros PDF

**Symptôme.** L'import d'un relevé PDF de 20 Mo ou plus prend
plusieurs minutes ; la barre de progression reste sur « extraction du
texte » longtemps.

**Cause.** L'OCR passe sur chaque page d'un PDF scanné (les relevés
scannés des banques plus anciennes en sont la cause habituelle),
même si seules quelques pages contiennent effectivement un tableau
de transactions.

**Correction.** Découpez le PDF sur les pages pertinentes avant
l'import — `pdftk statement.pdf cat 3-8 output slice.pdf`, ou
utilisez Aperçu sur macOS. Si votre banque produit systématiquement
des PDF scannés, demandez-lui des exports en texte (généralement
disponibles sous un autre menu).

### Une transaction que vous savez présente n'apparaît pas dans la recherche

**Symptôme.** Vous cherchez par libellé, montant ou date, et une
transaction que vous voyez dans la vue compte n'apparaît pas dans les
résultats.

**Cause.** La recherche matche contre le libellé *normalisé*
(accents supprimés, ponctuation aplatie), pas celui brut que vous
voyez dans la liste — chercher `café` trouve `Café` mais pas
`CAFE-BAR` si la normalisation a conservé le tiret.

**Correction.** Cherchez sur un fragment plutôt qu'un mot complet
(`caf` au lieu de `café`), ou cherchez par montant (les montants
uniques sont le moyen le plus rapide de retrouver une ligne
précise). Voir [Catégorisation](./categorization) pour le pipeline
de normalisation — les mêmes règles s'appliquent à la recherche.

## Recueillir des diagnostics

Avant d'ouvrir une issue, rassemblez ces trois éléments — ils
résolvent la plupart des tickets dès le premier échange.

### Logs des conteneurs (installation Docker)

```sh
docker compose logs --tail=200 backend
docker compose logs --tail=200 db
```

Les 200 dernières lignes suffisent en général. Si le problème est au
démarrage, ajoutez `--since 5m` pour couvrir une fenêtre complète.
Masquez toute ligne qui contient `SESSION_SECRET`, `DATABASE_URL` ou
la valeur d'un cookie avant de coller.

### Endpoint `/health`

```sh
curl -s http://localhost:8001/health
```

Renvoie `{ "status": "ok", "db": "ok" }` quand tout est câblé.
`{ "db": "down" }` restreint le problème à Postgres ; une erreur de
connexion le restreint au backend ou à son binding de port. Le port
backend par défaut est `8001` — modifiez-le si vous avez fixé
`BACKEND_PORT` dans `.env`.

### Endpoint `/metrics`

```sh
curl -s http://localhost:8001/metrics
```

Expose les compteurs et histogrammes au format Prometheus. Les deux
lignes utiles à grepper quand quelque chose paraît lent sont
`http_request_duration_seconds` (latence par route) et
`athena_imports_failed_total` (échecs d'import par motif). Joignez un
extrait de la sortie à votre issue si vous rapportez une régression
de performance.

*Voir aussi :* [Importer](./importing) ·
[Démarrage](./getting-started) ·
[Sauvegarde et restauration](./backup-recovery)

← [Retour aux docs utilisateur](README.md)
