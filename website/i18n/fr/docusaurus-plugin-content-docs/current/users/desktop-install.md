---
title: Installation bureau
sidebar_position: 3
---

# Installation bureau

L'application de bureau est la façon « pas d'installation, pas de Docker » de faire tourner Athena. C'est une application unique sur macOS, Windows ou Linux — vous double-cliquez, une fenêtre s'ouvre, et tout (base de données, backend, interface) tourne dans ce processus, sur votre propre machine. Pas de LAN, pas d'autres utilisateurs, pas de cloud.

Si vous voulez un serveur familial auquel tout le foyer se connecte, sautez cette page et lisez plutôt **[Démarrage avec Docker](getting-started.md)**.

## Télécharger

Choisissez le fichier correspondant à votre OS dans la dernière release :

- **[Dernière release sur GitHub](https://github.com/Gekkotron/Athena-Accounting/releases/latest)**

| OS | Fichier |
|----|---------|
| macOS (Apple Silicon ou Intel) | `Athena-Accounting_<version>_universal.dmg` |
| Windows 10 / 11 (x64) | `Athena-Accounting_<version>_x64-setup.exe` |
| Linux (x64) | `Athena-Accounting_<version>_amd64.AppImage` |

Chaque artefact est construit par le workflow GitHub Actions `desktop-release` directement depuis un commit tagué sur `main`. Les sommes de contrôle sont publiées à côté des artefacts, sur la même page de release.

## Premier lancement

### macOS

1. Ouvrez le `.dmg` et glissez **Athena Accounting** dans `Applications`.
2. Au premier lancement, macOS affiche *« Athena Accounting can't be opened because Apple cannot check it for malicious software »* — l'application n'est pas encore signée avec un certificat Apple Developer. Fermez la boîte de dialogue, puis clic droit sur l'app dans le Finder → **Ouvrir** → **Ouvrir** dans la nouvelle boîte de dialogue. macOS mémorise votre choix ; les lancements suivants se font par un double-clic normal.
3. Si Gatekeeper refuse malgré le clic droit → Ouvrir, exécutez une fois depuis un terminal : `xattr -dr com.apple.quarantine "/Applications/Athena Accounting.app"`.

### Windows

1. Lancez l'installateur `.exe`. SmartScreen affiche *« Windows a protégé votre PC »* parce que le binaire n'est pas signé. Cliquez sur **Informations complémentaires** → **Exécuter quand même**.
2. L'installateur crée une entrée dans le menu Démarrer et un raccourci sur le bureau.

### Linux

1. Rendez le `.AppImage` exécutable : `chmod +x Athena-Accounting_*.AppImage`.
2. Double-cliquez, ou lancez-le depuis un terminal.

### Une fois la fenêtre ouverte

Vous verrez le même **écran d'onboarding** que l'installation Docker : choisissez un nom d'utilisateur et un mot de passe. En mode bureau, il n'y a qu'un seul utilisateur, donc c'est simplement votre mot de passe local pour déverrouiller l'application — mais il est quand même haché avec argon2id avant de toucher la base locale.

À partir de là, le reste de la documentation s'applique tel quel : créer un compte, importer un relevé, catégoriser les transactions. Voir **[Vos dix premières minutes](getting-started.md#vos-dix-premières-minutes)**.

## Où vivent vos données

L'application écrit tout — le fichier PGlite, les relevés importés, les exports de sauvegarde — dans un **dossier de données** par OS. Rien ne sort de ce dossier ; il n'y a aucun trafic réseau au-delà de localhost.

| OS | Chemin |
|----|--------|
| macOS | `~/Library/Application Support/Athena Accounting/` |
| Windows | `%APPDATA%\Athena Accounting\` (typiquement `C:\Users\<vous>\AppData\Roaming\Athena Accounting\`) |
| Linux | `~/.local/share/Athena Accounting/` (ou `$XDG_DATA_HOME/Athena Accounting/` si défini) |

À l'intérieur, vous trouverez :

- `athena.db` — la base PGlite (tous vos comptes, transactions, règles, budgets).
- `uploads/` — copies des fichiers de relevés que vous avez importés.
- `backups/` — exports de sauvegarde déclenchés depuis l'interface ou via l'endpoint MCP.

Vous pouvez outrepasser l'emplacement en définissant la variable d'environnement `ATHENA_DATA_DIR` avant de lancer l'application (utile si vous gardez la base sur un disque externe).

## Comment sauvegarder

Deux méthodes, utilisez les deux :

**1. Export de sauvegarde depuis l'interface.** *Réglages → Sauvegarde → Exporter*. Écrit un unique fichier JSON contenant chaque compte, transaction, point de contrôle, split, règle, catégorie et budget. C'est le même format que l'installation Docker, vous pouvez donc déplacer une base entre les deux distributions à tout moment.

**2. Copier le dossier de données.** Quittez l'application, puis copiez le dossier de données ci-dessus (ou juste `athena.db`) vers votre destination de sauvegarde — un autre disque, un NAS, un dossier de synchro cloud. Le fichier PGlite est un fichier unique ; un simple `cp`/`copy` suffit. Pour restaurer, remettez le fichier en place avant de lancer l'application.

La métrique Prometheus `athena_backup_last_success_timestamp_seconds` que le mode Docker expose n'est pas remontée en mode bureau — rien ne la scrape. Utilisez un rappel de calendrier à la place.

## Désinstaller

- **macOS** — glissez l'application dans la corbeille, puis supprimez `~/Library/Application Support/Athena Accounting/` si vous voulez aussi effacer vos données.
- **Windows** — *Paramètres → Applications → Athena Accounting → Désinstaller*, puis supprimez `%APPDATA%\Athena Accounting\` pour les données.
- **Linux** — supprimez le `.AppImage`, puis supprimez `~/.local/share/Athena Accounting/`.

## MCP depuis l'application bureau

Le serveur MCP est également disponible en mode bureau : l'application écrit son port courant dans `${DATA_DIR}/.mcp-port` au démarrage, et l'écran *Réglages → MCP* propose un bouton **Copier la config MCP** qui produit un extrait prêt à coller pour Claude Desktop / Cursor / n'importe quel autre client MCP. Voir **[Accès MCP](mcp.md)** pour la marche à suivre complète.

## Limites connues

- **Un seul utilisateur.** Le mode bureau tourne en interne avec `AUTH_MODE=none`. Si plusieurs personnes doivent partager la même instance, passez par le chemin Docker.
- **Pas d'accès LAN.** Le backend écoute sur `127.0.0.1` sur un port assigné par le système. Les autres appareils du réseau ne peuvent pas l'atteindre, par conception.
- **Binaires non signés** sur macOS et Windows. Cela changera une fois que le projet aura un compte Apple Developer ; en attendant, le contournement clic droit → Ouvrir / *Exécuter quand même* est un coût unique.
- **Taille du bundle** de 50 à 80 Mo par plateforme. Le sidecar embarque un runtime Node complet plus quelques modules natifs (sharp, canvas, argon2, PGlite, pdfjs, tesseract) ; un bundle plus fin ne vaudrait pas la fragilité.

← [Retour aux docs utilisateur](README.md)
