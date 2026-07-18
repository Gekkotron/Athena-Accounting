---
title: Sécurité et confidentialité
sidebar_position: 7
---

# Sécurité et confidentialité

Athena est conçu pour tourner sur votre propre machine et y rester. Pas
de cloud, pas de télémétrie, pas d'analytics tiers — le seul trafic
réseau qu'Athena initie est celui que vous demandez (un import, un export
de sauvegarde, un appel MCP vers un modèle que vous connectez vous-même).

## Modèle de sécurité

**LAN-only par défaut.** Le stack Docker Compose expose le frontend et le
backend sur votre hôte, et la posture recommandée est de garder Athena
accessible uniquement depuis votre réseau local — derrière votre box, pas
exposé sur l'internet public. Le build Tauri (application de bureau) va
un cran plus loin : il se lie à `127.0.0.1` sur un port aléatoire et
n'est joignable depuis aucune autre machine.

**Authentification.** Le chemin d'authentification par session
(`AUTH_MODE=session`, le défaut Docker) utilise `@fastify/session` avec un
cookie signé. À la connexion, l'identifiant de session est régénéré
(`req.session.regenerate()`) pour prévenir la fixation de session, et
`/api/auth/logout` détruit la session côté serveur. Le login est limité
en fréquence par `@fastify/rate-limit` pour ralentir les tentatives de
force brute sur les mots de passe faibles.

**Hachage des mots de passe.** Les mots de passe sont hachés avec
**argon2id** via `@node-rs/argon2`, avec les paramètres minimums OWASP
2024 (19 Mio de mémoire, 2 itérations, parallélisme 1) et un sel
aléatoire par utilisateur. Ni le mot de passe brut ni une représentation
réversible ne sont stockés.

**Verrou anti-takeover au premier lancement.** L'onboarding crée le
premier compte administrateur puis verrouille l'endpoint — les visiteurs
suivants ne peuvent pas enregistrer un nouvel administrateur par-dessus
le vôtre. Ajoutez d'autres utilisateurs depuis la page Réglages une fois
connecté.

**Chemin Desktop.** Le build Tauri tourne avec `AUTH_MODE=none` : pas de
cookies, pas d'écran de connexion, un unique utilisateur local est semé
au premier démarrage. Ce compromis est sûr parce que le backend ne quitte
jamais `127.0.0.1` — aucun autre processus du LAN ne peut l'atteindre.

## Frontière réseau

**Postgres lié à 127.0.0.1.** Dans le fichier Docker Compose livré, le
service Postgres n'est pas exposé sur `0.0.0.0` — son port est lié à
l'interface loopback, si bien que la base est accessible au conteneur
backend via le réseau Docker interne mais pas depuis les autres machines
du LAN. La seule surface volontairement accessible depuis le LAN est le
port HTTP du frontend. Voir la
[Référence de configuration](../reference/configuration.md) pour les
ports par défaut.

**Endpoint MCP.** `/api/mcp/rpc` est la seule route prévue pour accepter
des appels distants d'un runtime de modèle (Claude Desktop, Cursor, etc.).
Elle est protégée par un jeton porteur par utilisateur, que vous générez
depuis Réglages → MCP. Chaque jeton est **chiffré au repos** avec
`pgcrypto` et l'enveloppe requête/réponse est chiffrée avec la même clé,
si bien qu'un observateur sur le fil ne voit que du texte chiffré.
Révoquer un jeton depuis Réglages l'invalide immédiatement.

## Les sauvegardes sont en clair

L'export de sauvegarde d'Athena (`/api/backup/export`, ou le bouton dans
l'onglet Données) écrit une enveloppe JSON contenant tous les comptes,
transactions, catégories, règles, budgets et points de contrôle **en
clair**. C'est volontaire — la récupération après sinistre devient
triviale, et on peut differ des exports historiques avec n'importe quel
outil texte — mais cela veut dire que le fichier de sauvegarde est aussi
sensible que la base elle-même. Rangez-le comme vous rangeriez l'export
d'un gestionnaire de mots de passe : une image disque chiffrée, un disque
externe chiffré, ou un dossier cloud personnel lui-même chiffré au repos.
Ne vous l'envoyez pas par email en clair.

Voir [Sauvegarde et restauration](backup-recovery.md) pour le tour
complet et le playbook de récupération d'un fichier corrompu.

## Posture de confidentialité

- **Pas de télémétrie.** Athena n'appelle pas la maison. Pas de métriques
  d'usage, pas de rapports de crash, pas de balise analytics « anonyme » —
  rien ne quitte votre machine sans que vous le déclenchiez.
- **Pas d'analytics tiers.** Le frontend ne charge ni Google Analytics,
  ni Plausible, ni Segment, ni Sentry, ni équivalent. Aucun script tiers
  sur aucune page.
- **Pas de cloud.** Il n'y a pas de service backend Athena, pas de
  système de compte partagé, pas de « Se connecter avec Athena ». Chaque
  installation est autonome.
- **Vos données restent vos données.** Le fichier de base vit dans votre
  `DATA_DIR` (voir la
  [Référence de configuration](../reference/configuration.md)) ; les
  sauvegardes atterrissent là où vous le décidez. Désinstaller Athena et
  supprimer ce dossier constitue un effacement complet.

## Voir aussi

- [Sauvegarde et restauration](backup-recovery.md) — exporter, restaurer
  et récupérer d'une base corrompue.
- [Référence de configuration](../reference/configuration.md) — les
  variables d'environnement derrière l'authentification, la session, le
  binding réseau et le choix du dossier de données.

← [Retour aux docs utilisateur](README.md)
