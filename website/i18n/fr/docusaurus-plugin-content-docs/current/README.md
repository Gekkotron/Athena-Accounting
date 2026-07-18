---
title: Accueil de la documentation
sidebar_position: 0
---

# Documentation Athena-Accounting

Athena-Accounting est une solution de comptabilité personnelle auto-hébergée pour celles et ceux qui veulent que leurs données bancaires restent sur leur propre réseau. C'est le guide approfondi ; si vous voulez juste installer et lancer, le [README principal](https://github.com/Gekkotron/Athena-Accounting#readme) couvre le démarrage rapide.

La documentation se répartit en deux volets et une section de référence.

## Pour les utilisateurs

Vous avez installé Athena (ou vous prévoyez de le faire) et vous voulez le comprendre.

- **[Démarrage](users/getting-started.md)** — installation, onboarding initial, vos dix premières minutes.
- **[Importer](users/importing.md)** — relevés bancaires OFX, CSV français et PDF, incluant l'assistant interactif de modèles.
- **[Catégorisation](users/categorization.md)** — règles, onglet Tri, détection des virements internes.
- **[Tableau de bord](users/dashboard.md)** — courbe du solde, donut par catégorie, insights, Sankey, budgets.
- **[Comptes et données](users/accounts-and-data.md)** — multi-comptes, points de contrôle du solde, argent bloqué, sauvegardes.
- **[Sécurité et confidentialité](users/security-and-privacy.md)** — argon2id, sessions, mode confidentialité, posture LAN-only.
- **[Accès MCP](users/mcp.md)** — serveur Model Context Protocol local optionnel pour l'accès LLM.
- **[Dépannage](users/troubleshooting.md)** — FAQ et problèmes courants.

## Pour les contributeurs

Vous voulez lire, corriger ou étendre le code.

- **[Architecture](contributors/architecture.md)** — schéma du système, découpage des services, flux de requêtes.
- **[Carte du code](contributors/code-map.md)** — visite guidée des dossiers.
- **[Développement](contributors/development.md)** — installation locale, exécution des tests, flux de PR.
- **[Base de données](contributors/database.md)** — schéma et migrations.

## Référence

Consultation pure, sans narration.

- **[Configuration](reference/configuration.md)** — variables d'environnement, ports, valeurs par défaut.
- **[Points d'API](reference/api-endpoints.md)** — surface REST.
- **[Glossaire](reference/glossary.md)** — termes français ↔ anglais de l'interface.

## Ce n'est pas ce que vous cherchez ?

- Le **[README principal](https://github.com/Gekkotron/Athena-Accounting#readme)** est le point d'entrée pour installer Athena.
- **Les bugs et demandes** vivent sur le [suivi d'incidents](https://github.com/Gekkotron/Athena-Accounting/issues).
- Si Athena vous aide, pensez à **[soutenir le projet](https://github.com/sponsors/Gekkotron)**.
