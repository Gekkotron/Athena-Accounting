---
title: Accès MCP
sidebar_position: 8
---

# Accès MCP

Athena embarque un serveur [Model Context Protocol](https://modelcontextprotocol.io) (MCP) optionnel, pour qu'un LLM local — par exemple un modèle qui tourne dans [Ollama](https://ollama.com), piloté par un client MCP compatible — puisse créer, modifier, supprimer et rechercher vos transactions.

## Ce que c'est

- Un serveur MCP **stdio** local (`mcp/`) qui expose 6 outils pour travailler sur les transactions (voir [Référence des outils](#référence-des-outils) plus bas). Il tourne comme un processus enfant de votre client MCP — le serveur en lui-même n'expose rien sur le réseau.
- Chaque requête/réponse entre le serveur MCP et le backend Athena (`POST /api/mcp/rpc`) est chiffrée de bout en bout avec un jeton par utilisateur, en AES-256-GCM. Le backend dérive une clé de contenu à partir de votre jeton et ne stocke qu'une copie **wrappée** (chiffrée) de cette clé — jamais le jeton lui-même. Rien de vos transactions ne traverse le LAN en clair, et TLS par-dessus reste optionnel (utile si vous voulez aussi masquer les métadonnées comme la taille/le timing des requêtes, mais pas nécessaire pour la confidentialité du contenu).
- Ollama en lui-même n'est **pas** un client MCP — c'est le backend de modèle qu'un client MCP-aware (par exemple `mcphost`, `oterm`, Claude Desktop) pointe. Le serveur MCP Athena est agnostique du modèle : il répond juste aux appels d'outils sur stdio, quel que soit l'usage qu'en fait le client.

## 1. Activer l'accès MCP

1. Ouvrez **Réglages** (l'icône engrenage à côté de votre nom d'utilisateur dans la sidebar).
2. Dans la section **Accès MCP**, activez **Activer l'accès MCP**.
3. Cliquez sur **Générer un jeton**. Le jeton est affiché **une seule fois** — copiez-le maintenant. Vous ne pourrez pas le revoir ; si vous le perdez, générez-en un nouveau (ce qui invalide immédiatement le précédent).

## 2. Construire le serveur

```sh
cd mcp
npm install
npm run build
```

Cela produit `mcp/dist/index.js`, le point d'entrée que votre client MCP lancera.

## 3. Configurer votre client MCP

Pointez votre client MCP vers le serveur construit, en passant les trois variables d'environnement requises. Exemple de configuration (la forme JSON utilisée par Claude Desktop et plusieurs autres clients MCP) :

```json
{
  "mcpServers": {
    "athena": {
      "command": "node",
      "args": ["/chemin/absolu/vers/Athena-Accounting/mcp/dist/index.js"],
      "env": {
        "ATHENA_API_URL": "http://<mini-pc-host>:8001",
        "ATHENA_MCP_USER": "<votre-nom-utilisateur-athena>",
        "ATHENA_MCP_TOKEN": "<coller-le-jeton-ici>",
        "ATHENA_STATEMENTS_DIR": "/Users/vous/RelevésAthena"
      }
    }
  }
}
```

Remplacez les placeholders :

- `ATHENA_API_URL` — l'URL de votre backend Athena (par exemple l'adresse LAN et le port où `backend` est joignable). Ne pas mettre de barre oblique finale.
- `ATHENA_MCP_USER` — votre nom d'utilisateur de login Athena.
- `ATHENA_MCP_TOKEN` — le jeton généré à l'étape 1.
- `ATHENA_STATEMENTS_DIR` *(optionnel)* — un dossier contenant vos PDF de relevés. Quand il est défini, `reconcile_statement` résout un **nom de fichier nu** (par exemple `avril.pdf`) contre ce dossier, ce qui vous évite de taper un chemin absolu complet. Un `~` initial est étendu, et si un fichier n'est pas trouvé, l'erreur liste les `.pdf` réellement présents dans le dossier.

Les trois premiers sont requis ; le serveur refuse de démarrer si l'un manque.

### Application bureau (Tauri) : utiliser un fichier de port au lieu de `ATHENA_API_URL`

La distribution bureau lie Fastify à `127.0.0.1` sur un port assigné par l'OS, donc l'URL change à chaque lancement. Au lieu de coder une URL en dur, pointez le pont MCP sur le fichier de port que l'application écrit au démarrage :

```json
{
  "mcpServers": {
    "athena": {
      "command": "node",
      "args": ["/chemin/absolu/vers/Athena-Accounting/mcp/dist/index.js"],
      "env": {
        "ATHENA_PORT_FILE": "<DATA_DIR>/.mcp-port",
        "ATHENA_MCP_USER": "<votre-nom-utilisateur-athena>",
        "ATHENA_MCP_TOKEN": "<coller-le-jeton-ici>"
      }
    }
  }
}
```

`<DATA_DIR>` est l'endroit où l'application bureau stocke ses données — le même dossier qui contient `athena.db`. Valeurs par défaut par OS :

- macOS : `~/Library/Application Support/com.athena.accounting.desktop/`
- Linux : `~/.local/share/com.athena.accounting.desktop/`
- Windows : `%APPDATA%\com.athena.accounting.desktop\`

Le pont lit le port depuis ce fichier à chaque démarrage, donc ouvrir et fermer l'application bureau entre les sessions du client MCP fonctionne de manière transparente. Si `ATHENA_API_URL` et `ATHENA_PORT_FILE` sont tous les deux définis, `ATHENA_API_URL` prend le pas.

## 4. Utiliser avec Ollama

Si vous voulez que le client MCP utilise un modèle Ollama local, cela se configure dans le **client**, pas dans le serveur MCP d'Athena. Par exemple, `mcphost` et `oterm` vous laissent tous deux choisir un modèle Ollama comme backend, tout en utilisant ce serveur (et d'autres) comme fournisseurs d'outils. Consultez la documentation de votre client pour savoir comment le pointer vers Ollama — le serveur Athena n'a aucune connaissance ni dépendance vis-à-vis du modèle qui pilote la conversation.

## Référence des outils

| Outil | Rôle | Arguments clés |
|-------|------|----------------|
| `list_accounts` | Lister les comptes avec soldes et ids. | — |
| `list_categories` | Lister les catégories avec ids et types. | — |
| `search_transactions` | Rechercher/lister des transactions. À utiliser pour trouver un id de transaction avant de la modifier ou supprimer. | `search`, `accountId`, `categoryId`, `fromDate`, `toDate` (`YYYY-MM-DD`), `amount` (chaîne décimale), `limit` (1–500), `offset` |
| `create_transaction` | Créer une transaction. Montant négatif = dépense, positif = revenu. | `accountId` (requis), `date` (requis, `YYYY-MM-DD`), `amount` (requis, chaîne décimale), `rawLabel` (requis, 1–512 caractères), `notes` (optionnel, ≤2000 caractères), `categoryId` (optionnel), `lockYears` (optionnel, 0–99) |
| `update_transaction` | Modifier les champs d'une transaction existante par id. | `id` (requis), plus n'importe lequel de `accountId`, `date`, `amount`, `rawLabel`, `categoryId` (nullable), `notes` (nullable), `lockYears` (nullable) |
| `delete_transaction` | Supprimer une transaction par id. | `id` (requis) |
| `reconcile_statement` | Rapprocher un PDF de relevé bancaire avec les transactions d'Athena (lecture seule). Voir [Rapprocher un relevé](#rapprocher-un-relevé) plus bas. | `path` (requis, chemin absolu du PDF), `accountId` (requis), `fromDate`, `toDate` (`YYYY-MM-DD`) |

Les montants sont des chaînes décimales avec jusqu'à 2 décimales (par exemple `"-42.50"`). Les dates sont au format `YYYY-MM-DD`.

## Sécurité

- Le jeton MCP est un **identifiant CRUD complet** sur vos données de transaction — traitez-le comme un mot de passe. Quiconque le détient peut lire, créer, modifier et supprimer vos transactions via le serveur MCP.
- Le jeton est affiché **une seule fois**, à la génération, et n'est jamais stocké en clair côté serveur (le backend ne garde qu'une clé wrappée sous une clé dérivée de `SESSION_SECRET`).
- Vous pouvez révoquer ou régénérer le jeton à tout moment depuis **Réglages → Accès MCP** (cliquer sur **Régénérer le jeton** / **Révoquer** invalide immédiatement le précédent — tout client MCP en cours qui l'utilise va commencer à échouer à l'authentification et aura besoin du nouveau jeton).
- Faire tourner le `SESSION_SECRET` du backend invalide toutes les clés MCP wrappées (le backend ne peut plus les déballer), ce qui révoque de fait tous les jetons MCP. Après une rotation de `SESSION_SECRET`, générez un nouveau jeton dans Réglages et mettez à jour la configuration de votre client MCP.

## Test de fumée manuel

Avec le backend Athena en cours d'exécution :

1. Activez l'accès MCP et générez un jeton dans Réglages (voir étape 1 ci-dessus).
2. Construisez le serveur (`cd mcp && npm install && npm run build`).
3. Configurez votre client MCP avec les trois variables d'environnement de l'étape 3, en pointant `command`/`args` vers `mcp/dist/index.js`.
4. Lancez le client pour qu'il démarre le serveur (ou lancez `node mcp/dist/index.js` directement sous le transport stdio du client).
5. Depuis le client, appelez `list_accounts` — il doit retourner vos comptes et soldes. Puis appelez `create_transaction` avec un `accountId`, `date`, `amount` et `rawLabel` valides — il doit retourner la transaction créée, que vous pourrez confirmer dans l'interface d'Athena.

## Rapprocher un relevé

`reconcile_statement` vérifie un PDF de relevé bancaire contre ce qui est déjà enregistré dans Athena, sans rien changer.

### Ce qu'il fait

- Lit le PDF que vous lui indiquez et le parse en utilisant le **même modèle d'import** qu'Athena a déjà sauvegardé pour ce compte (les zones qui disent à Athena où se trouvent les colonnes date/montant/libellé sur la page).
- Compare les lignes du relevé parsé aux transactions Athena pour le compte et la plage de dates, et ventile le résultat en :
  - **matched** — ligne du relevé trouvée dans Athena avec la même date, le même montant et le même libellé.
  - **missing** — présent sur le relevé, absent d'Athena.
  - **mismatched** — une transaction existante a le même libellé normalisé et une date à ±3 jours de la ligne du relevé ; si le montant diffère aussi, c'est rapporté comme `amount_differs`, sinon (même montant, juste décalé de quelques jours) c'est `date_off`.
  - **extra** — dans Athena pour ce compte/cette période, absent du relevé (les virements entre vos propres comptes sont exclus de ce panier).
- Le backend produit un résumé lisible (`summaryText`) à côté des paniers structurés. L'outil — et le LLM qui l'appelle — ne fait **que lire** ; il ne crée, ne modifie et ne supprime jamais de transaction.

### Prérequis : un modèle d'import sauvegardé

Le compte contre lequel vous rapprochez doit déjà avoir un modèle d'import PDF fonctionnel. Si vous n'avez jamais importé de relevé de cette combinaison banque/compte via l'écran normal d'import PDF d'Athena, il n'y a pas encore de modèle, et `reconcile_statement` échouera avec une erreur `needs_template` au lieu de deviner la mise en page. Importez le relevé (ou n'importe quel relevé du même modèle de banque) une fois via l'interface d'Athena d'abord, puis réessayez l'outil.

`needs_template` peut arriver pour plusieurs raisons :

- `no_text_layer` — le PDF n'a pas de couche texte extractible (par exemple une image scannée) ; l'import d'Athena a besoin d'une couche texte pour entraîner un modèle.
- `no_template` — aucun modèle n'a été sauvegardé pour cette mise en page de relevé + compte.
- `template_stale` — un modèle existe mais la mise en page du PDF ne correspond plus (par exemple la banque a changé son format de relevé) ; ré-entraînez le modèle via un import frais dans Athena.

Un PDF protégé par mot de passe renvoie une erreur `pdf_encrypted` séparée — retirez le mot de passe avant de réessayer.

### Usage dans LM Studio

1. Chargez un modèle capable d'outils dans LM Studio (ou un autre client MCP-aware) avec le serveur MCP Athena configuré comme décrit plus haut.
2. Dans le chat, demandez quelque chose comme :

   > Utilise reconcile_statement avec path /Users/vous/relevés/avril.pdf et accountId 66.

3. Le modèle appelle `reconcile_statement` et vous lisez son résumé — par exemple, « 12 lignes de relevé : 10 matchées, 1 manquante, 1 mismatch, 0 extra », suivi des détails des lignes manquantes/mismatched.

Pas sûr de l'id du compte ? Appelez d'abord `list_accounts` — il retourne l'id de chaque compte avec son nom et son solde.

### Ajouter les transactions manquantes

`reconcile_statement` n'écrit jamais dans Athena, il ne peut donc pas ajouter à votre place les lignes qu'il rapporte comme manquantes. Pour les ajouter, importez le **même PDF** via le flux d'import de relevé normal d'Athena : la logique de déduplication de l'importeur n'insérera que les transactions qui ne sont pas déjà enregistrées et sautera tout ce qui est déjà là.

### Référence de l'outil

`reconcile_statement(path, accountId, fromDate?, toDate?)`

- `path` (requis) — le PDF du relevé **sur la machine qui fait tourner le serveur MCP** (pas la machine qui fait tourner le client de chat). Soit un **nom de fichier nu** résolu contre `ATHENA_STATEMENTS_DIR` (voir étape 3), soit un chemin absolu ; un `~` initial est étendu. Doit se terminer par `.pdf` et faire au plus 10 Mo.
- `accountId` (requis) — l'id du compte Athena à rapprocher — le petit entier de `list_accounts`, **pas** le numéro de compte bancaire.
- `fromDate`, `toDate` (optionnels, `YYYY-MM-DD`) — restreignent la fenêtre de comparaison. Omis, la fenêtre par défaut prend les dates les plus anciennes/récentes trouvées sur le relevé parsé.

### Limite connue : transactions importées via OFX/QFX

Le matching s'appuie sur une clé de dédup dérivée du compte + date + montant + libellé normalisé. Les transactions initialement importées depuis un fichier **OFX/QFX** sont clés différemment : l'id de transaction propre à la banque (FITID), quand il est présent, est utilisé à la place de cette clé dérivée, parce qu'il est plus durable face aux modifications de libellé. Cela signifie qu'une transaction importée par OFX ne partagera pas la même clé de dédup que la ligne équivalente parsée d'un relevé PDF, et le rapprochement d'un relevé PDF contre des transactions importées par OFX peut rapporter une correspondance exacte comme un **mismatch** (typiquement avec une raison de date) alors même qu'il s'agit réellement de la même transaction.

Rapprocher un relevé PDF contre des transactions elles-mêmes importées d'un PDF, ou créées manuellement / via `create_transaction`, matche exactement, puisque les deux côtés utilisent la même clé de dédup dérivée.
