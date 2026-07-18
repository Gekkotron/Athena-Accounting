---
title: Importer
sidebar_position: 3
---

# Importer

L'import est le cœur d'Athena. Cette page couvre tous les formats acceptés, l'assistant de modèles PDF (la pièce que la plupart des gens trouvent magique), la gestion des relevés multi-comptes, la déduplication, et quoi faire quand quelque chose ne s'importe pas proprement.

## Formats supportés

| Format | Comment Athena le lit |
|--------|-----------------------|
| **OFX / QFX** | Format d'échange standard des banques. Athena parse l'OFX de style SGML en Latin-1 (Windows-1252) ou UTF-8 — l'encodage est détecté depuis l'en-tête OFX. L'import est une étape unique glisser-déposer. |
| **CSV (banques françaises)** | Séparateur détecté automatiquement (`;` ou `,`), format de date français `JJ/MM/AAAA`, virgule décimale française. Les noms de colonnes sont matchés sans tenir compte des accents ni de la casse. Athena attend une colonne date, une colonne libellé, et soit une colonne `Montant` soit une paire `Débit` + `Crédit`. |
| **PDF** | Relevés bancaires en PDF. Le premier relevé d'une nouvelle banque passe par l'assistant de modèle (ci-dessous). Les relevés suivants dans le même format s'importent automatiquement. |

Vous pouvez déposer un **fichier unique**, **plusieurs fichiers d'un coup**, ou **un dossier entier**. Les fichiers sont traités séquentiellement et chacun reçoit son propre résumé sur une ligne : insérés / sautés / modèle-requis / en erreur.

## Avant d'importer

Créez d'abord le compte de destination (*Comptes → Ajouter*). Le solde d'ouverture et la date d'ouverture sont obligatoires — chaque solde affiché est calculé comme `solde_ouverture + SUM(montant WHERE date >= date_ouverture)`.

Optionnellement, ajoutez des **motifs de nom de fichier** sur le même onglet du compte. Athena compare le motif au fichier que vous déposez et choisit automatiquement le compte cible, ce qui vous évite d'en sélectionner un à chaque fois.

## OFX et CSV

Les deux sont en une étape. Déposez le fichier sur la page Imports ; Athena le parse, applique les règles de catégorisation et insère les nouvelles transactions. La réponse rapporte les compteurs insérés vs dédupliqués.

**Note d'encodage (OFX) :** Les banques françaises émettent typiquement leur OFX en Windows-1252. Athena détecte l'encodage depuis l'en-tête OFX et ré-encode en UTF-8 pour la base. Si votre fichier OFX a des accents cassés dans le libellé après import, c'est un bug — merci d'ouvrir une issue avec un échantillon caviardé.

## L'assistant de modèles PDF

Les PDF n'ont pas de format de transaction machine-readable comme l'OFX. Athena résout ça en vous demandant de **peindre les zones de transaction une fois par format de banque**, puis en réutilisant ce modèle pour tous les relevés futurs dans le même format.

### Flux de première fois

1. Déposez un PDF d'une nouvelle banque sur la page Imports.
2. Athena ouvre l'assistant de modèle : votre PDF à gauche, trois outils à droite — **Montant**, **Date**, **Libellé**.
3. Dessinez un rectangle sur une occurrence de chacun des trois champs. Vous apprenez à Athena que « les montants vivent dans cette colonne, les dates dans celle-ci, les libellés dans celle-là ».
4. Athena rejoue le modèle sur tout le PDF et vous montre les transactions qu'il a trouvées. Si elles semblent correctes, sauvegardez le modèle et importez. Sinon, ajustez les rectangles.

Le modèle est stocké par format de banque / relevé. Le relevé suivant dans le même format saute complètement l'assistant.

### Relevés PDF multi-comptes

Certaines banques émettent un unique PDF qui contient plusieurs comptes (relevés joints, offres famille). Athena gère ça avec un **filtrage de pages basé sur le contenu** :

- Le modèle stocke une « ancre de compte » — un motif texte qui apparaît sur les pages appartenant à votre compte.
- À l'import, Athena garde seulement les pages qui correspondent à l'ancre et filtre le reste.
- Si des pages sont ambiguës, un sélecteur **« mien / autre compte »** vous laisse les assigner manuellement.

### Auto-récupération : quand un modèle cesse de matcher

Les banques reformulent parfois les en-têtes de relevé. Si un modèle sauvegardé cesse de trouver des transactions sur un nouveau relevé, Athena **auto-récupère** en ré-entraînant le modèle sur le nouveau relevé — vous ne perdez donc pas l'investissement de l'assistant quand votre banque livre un petit changement de mise en page.

## Déduplication

Chaque import compare les nouvelles transactions à ce qui est déjà en base. Les doublons sont détectés sur une signature de contenu (date, montant, compte, libellé normalisé) et silencieusement sautés.

Le résumé par fichier affiche un compteur **« lus mais dédupliqués »** pour distinguer « le fichier n'apportait rien de nouveau » de « le fichier était vide ou cassé ».

Chaque import écrit aussi une **ligne d'audit** — nom de fichier, hash, et compte des insérés / sautés / en erreur — donc ré-importer le même fichier deux fois est sûr et traçable. Un « 0 inséré » sur un ré-import signifie que les clés de dédup ont matché, pas que quelque chose s'est mal passé.

## Virements internes

Si vous avez deux comptes et que vous transférez de l'argent entre eux, les deux jambes apparaîtront dans leurs imports respectifs comme des dépenses / revenus ordinaires. Le détecteur de virement d'Athena les relie via un `transfer_group_id` partagé et les exclut des agrégats revenus/dépenses. Configurez les paires de mots-clés dans **Règles** (l'interface de règles de virement est minimale ; l'API se trouve à `/api/transfer-rules`). Une fois matché, l'importeur cherche la jambe miroir dans le compte homologue à ±7 jours.

## Dépannage

**« L'assistant de modèle dit qu'il ne trouve pas de transactions. »**
Vos rectangles sont probablement trop serrés. Les montants et les dates ont besoin d'un peu de marge horizontale ; les libellés demandent généralement une boîte plus large.

**« pdfjs a fragmenté le texte bizarrement. »**
Certains PDF rendent le texte en fragments qui se chevauchent. Le parseur d'Athena gère les cas courants ; si vous tombez sur un cas limite, merci d'ouvrir une issue avec un extrait de relevé caviardé.

**« Mon modèle marchait et il ne marche plus. »**
Relancez l'import — l'auto-récupération résout ça la plupart du temps. Si ça ne suffit pas, supprimez le modèle (*Réglages → Modèles*) et peignez-en un nouveau.

**« Une transaction que je voulais a été dédupliquée. »**
La déduplication utilise date + montant + compte + libellé normalisé. Deux transactions légitimement différentes avec les mêmes valeurs le même jour (rare mais possible — pensez à « deux cafés identiques ») peuvent entrer en collision. Ajoutez la seconde manuellement.

**« 0 inséré sur un ré-import — a-t-il échoué ? »**
Non. C'est la dédup qui fait son job. Comparez le compteur « lus » au compteur « dédupliqués » dans le résumé : s'ils correspondent, tout ce qui était dans le fichier était déjà en base.

## Où aller ensuite

- **[Catégorisation](categorization.md)** — une fois les transactions en base, catégorisez-les.
- **[Comptes et données](accounts-and-data.md)** — les points de contrôle du solde recoupent vos imports avec vos relevés bancaires.
- **[Dépannage](troubleshooting.md)** — d'autres modes de défaillance.

← [Retour aux docs utilisateur](README.md)
