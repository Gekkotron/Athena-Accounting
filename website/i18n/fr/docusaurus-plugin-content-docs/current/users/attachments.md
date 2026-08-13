---
title: Pièces jointes
sidebar_position: 5
---

# Pièces jointes

Attachez un reçu, une facture ou un contrat à une transaction pour que la
trace papier vive à côté de la ligne qu'elle explique. Les pièces jointes
sont stockées localement sur votre instance Athena — la philosophie
LAN-only, sans cloud, d'Athena s'applique à elles exactement comme au
reste de vos données.

## Ce que vous pouvez attacher

Chaque pièce jointe est envoyée depuis *Transactions → ouvrir une ligne
→ Pièces jointes → Ajouter…*. Types acceptés (détectés à partir des
« magic bytes » du fichier, pas de l'extension ni du `Content-Type` du
navigateur) :

- **Images** : JPEG, PNG, WebP, HEIC (formats typiques des photos de
  smartphone).
- **PDF** : documents à une ou plusieurs pages.

Tout le reste est refusé avec un message d'erreur avant même
d'atterrir sur le disque.

## Limites de taille et de nombre

- **10 Mo par fichier**, plafond strict. Les fichiers au-dessus sont
  refusés côté client avant l'envoi et à nouveau côté serveur (réponse
  413) si un appelant contourne le navigateur.
- **Aucune limite stricte par transaction**. En pratique, attacher plus
  d'une poignée de gros PDF à une même transaction ralentit la modale
  — répartissez-les sur des transactions liées si c'est possible.

L'icône trombone à côté du libellé dans la liste des transactions
indique le nombre de pièces jointes de la ligne, quand il y en a.

## Où les fichiers sont stockés

Les pièces jointes vivent sur le disque de votre machine Athena, sous
`<DATA_DIR>/attachments/<user_id>/<attachment_id>.bin`. Seules les
métadonnées (nom du fichier d'origine, type MIME, taille, date de
création) sont écrites en base — les octets ne sont jamais inlinés dans
la ligne Postgres/PGlite, donc les sauvegardes et les exports de base
de l'application desktop restent légers.

`<DATA_DIR>` dépend de la façon dont vous exécutez Athena — voir le
[guide d'installation](./desktop-install.md) et la [référence de
configuration](../reference/configuration.md) pour les règles exactes :

- **Docker** : dans le conteneur c'est `/data`, que docker-compose monte
  sur un volume nommé (ou le chemin que vous avez configuré). Incluez
  ce volume dans votre routine de sauvegarde côté hôte pour préserver
  les pièces jointes.
- **Application desktop** : le répertoire de données utilisateur du
  système (macOS `~/Library/Application Support/Athena/`, Windows
  `%APPDATA%\Athena\`, Linux `~/.local/share/Athena/`), avec le
  sous-dossier `attachments/` à côté du fichier de base PGlite.
- **Sans conteneur / `npm start`** : le répertoire de travail courant
  sauf si `DATA_DIR` est défini explicitement.

Seul Athena est censé écrire dans `attachments/` — n'y ajoutez pas, n'y
renommez pas et n'y supprimez pas de fichiers à la main. La base et le
disque se désynchronisent silencieusement sinon.

## Sauvegardes

Les pièces jointes ont leur **canal de sauvegarde séparé** — elles ne
sont volontairement pas inlinées dans le dump JSON principal. Une
bibliothèque de reçus peut peser des centaines de mégaoctets au fil du
temps ; l'inliner en base64 gonflerait chaque dump linéairement et
multiplierait le coût du chiffrement par passphrase. Deux canaux
gardent le dump JSON léger et permettent au canal des pièces jointes
de ne re-téléverser que quand quelque chose a réellement changé.

- **Export manuel** : *Données → Sauvegarde → Exporter les pièces
  jointes* télécharge une archive binaire chiffrée
  (`athena-attachments-YYYY-MM-DD-HHMMSSmmm.bin`). Même schéma de
  chiffrement que le dump JSON : AES-256-GCM sous une clé dérivée par
  scrypt. Une mauvaise passphrase à la restauration échoue proprement
  sans toucher vos données courantes.
- **Restauration manuelle** : *Données → Sauvegarde → Importer les
  pièces jointes* accepte l'archive chiffrée. Sémantique REPLACE pour
  l'utilisateur appelant : les pièces jointes courantes sont supprimées
  de la base et du disque, puis les entrées de l'archive sont
  reliées à leur transaction via la clé naturelle
  `(nom du compte, dedup key)`. Les entrées dont la transaction parente
  a été supprimée ou renommée sont ignorées silencieusement et
  comptabilisées dans le résumé.
- **Sauvegarde planifiée** : lorsqu'une destination distante est
  configurée (dossier, WebDAV ou FTP), chaque exécution nocturne
  téléverse toujours un nouveau dump JSON. L'archive des pièces
  jointes n'est téléversée **que si votre bibliothèque a changé
  depuis le dernier envoi réussi** — Athena en calcule une empreinte
  (nombre de lignes + horodatage le plus récent) et la compare à celle
  stockée sur la destination. Inchangée → sauté, ce qui économise
  bande passante et espace distant les jours calmes. La rétention
  keep-last s'applique indépendamment à chaque famille de fichiers.

Si vous sauvegardez la machine entière en dehors de la routine Athena
(rsync, Time Machine, borg…), inclure `<DATA_DIR>/attachments/` dans
cette sauvegarde suffit — vous n'avez pas besoin d'exécuter aussi
l'export d'archive Athena.

## Supprimer

*Pièces jointes → Supprimer* retire d'un coup la ligne en base et le
fichier sur le disque (une boîte de confirmation protège des
maladresses). Si la transaction parente est elle-même supprimée, ses
pièces jointes cascadent — les lignes disparaissent de la base, et les
fichiers sur le disque sont nettoyés au prochain écrit d'attachement
pour cet utilisateur. Aucun nettoyage manuel du disque n'est jamais
nécessaire.

## Confidentialité

- Les pièces jointes ne quittent jamais votre machine à moins que vous
  ne les exportiez explicitement.
- Les fichiers stockés **ne sont pas chiffrés au repos** par défaut —
  ils sont sur le disque avec les permissions que votre OS leur a
  données. Pour une barrière plus forte, hébergez Athena sur un volume
  chiffré (chiffrement de disque complet) ou enveloppez `<DATA_DIR>`
  dans un conteneur chiffré (LUKS, VeraCrypt, FileVault).
- Les archives de sauvegarde manuelles et planifiées **sont**, elles,
  chiffrées de bout en bout avec votre passphrase — vous pouvez donc
  les envoyer sur n'importe quel stockage auquel vous ne faites pas
  entièrement confiance sans exposer vos reçus.

## Voir aussi

- [Imports](./importing.md) — les imports de fichiers alimentent les
  transactions qui portent ces pièces jointes.
- [Sauvegardes et restauration](./backup-recovery.md) — la vue
  d'ensemble des sauvegardes, dont le partage de passphrase entre le
  dump JSON et l'archive des pièces jointes.
- [Sécurité et confidentialité](./security-and-privacy.md) — le modèle
  de sécurité d'Athena, dont le stockage local uniquement.
