---
title: Démarrage
sidebar_position: 2
---

# Démarrage

:::tip Essayez avant d'installer
Une démo interactive tourne dans votre navigateur — pas de compte, pas d'installation. Toutes les données restent en local (localStorage) et un bouton **Réinitialiser la démo** remet le jeu de données d'origine.
[Ouvrir la démo →](./demo)
:::

Athena existe en deux saveurs, à partir du même code. Choisissez celle qui correspond à votre usage — les deux restent en local, aucune ne parle au cloud, et vos données ne quittent jamais la machine sur laquelle vous l'installez.

## Choisissez votre parcours

<table>
  <thead>
    <tr>
      <th>Serveur familial (Docker)</th>
      <th>Usage solo (Bureau)</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Tourne comme une petite stack (Postgres + Fastify + nginx) sur une
          machine que vous laissez allumée — un NAS, un mini-PC, un vieux
          portable. Toute la famille l'atteint sur le LAN via un navigateur.</td>
      <td>Une application unique sur macOS, Windows ou Linux. Vous double-cliquez,
          une fenêtre s'ouvre, et tout tourne dans ce processus sur votre propre
          machine.</td>
    </tr>
    <tr>
      <td>Multi-utilisateur avec de vraies sessions de login. Gère les imports
          et tableaux de bord concurrents depuis plusieurs appareils.</td>
      <td>Mono-utilisateur. Le mot de passe d'onboarding déverrouille l'application
          localement ; pas de flux de login réseau.</td>
    </tr>
    <tr>
      <td>Nécessite Docker et Docker Compose sur l'hôte.</td>
      <td>Aucun prérequis. Téléchargez, installez, lancez.</td>
    </tr>
    <tr>
      <td>Les données vivent dans un volume Postgres que vous contrôlez.</td>
      <td>Les données vivent dans un dossier utilisateur par OS, sous la forme
          d'un unique fichier PGlite — facile à copier pour sauvegarder.</td>
    </tr>
    <tr>
      <td>➜ Continuez ci-dessous.</td>
      <td>➜ Rendez-vous à <a href="desktop-install.md"><strong>Installation bureau</strong></a>.</td>
    </tr>
  </tbody>
</table>

Les deux parcours partagent les mêmes fonctionnalités, la même interface, le même format de sauvegarde et le même endpoint MCP — les seules vraies différences sont celles du tableau ci-dessus. Un export de sauvegarde se déplace librement entre les deux.

Le reste de cette page suit le parcours **Docker**. Si vous avez choisi le bureau, direction **[Installation bureau](desktop-install.md)** puis revenez à [Vos dix premières minutes](#vos-dix-premières-minutes) — cette section s'applique aux deux parcours à l'identique.

## Parcours Docker — ce qu'il vous faut

- Un hôte Linux ou macOS avec Docker et Docker Compose. Windows fonctionne sous WSL 2 mais n'est pas la cible principale.
- Les ports `8000` (frontend), `8001` (backend) et `5432` (PostgreSQL) libres sur `127.0.0.1`. Frontend et backend écoutent sur toutes les interfaces par défaut pour que les autres appareils du LAN atteignent l'application ; Postgres reste sur loopback, le backend l'atteint via le réseau Compose.
- Un navigateur moderne.

Athena n'a **pas** besoin de nom de domaine, de certificat TLS ou d'IP publique. Il tourne sur votre LAN et y reste.

## Installer

Clonez le dépôt et lancez le script d'installation :

```bash
git clone https://github.com/Gekkotron/Athena-Accounting.git
cd Athena-Accounting
./install.sh
```

`install.sh` génère un fichier `.env` avec des secrets aléatoires solides (clé de session, mot de passe de la base) et le verrouille en mode `600`. Il **ne** crée **pas** d'utilisateur ; vous le faites à la première visite.

Lancez la stack :

```bash
docker compose up --build
```

Le premier build est lent (installation Node, extensions Postgres). Les démarrages suivants sont rapides.

Ouvrez [http://127.0.0.1:8000](http://127.0.0.1:8000).

## Onboarding initial

La première visite affiche un écran d'onboarding au lieu d'un formulaire de login. Il demande un nom d'utilisateur et un mot de passe.

- Votre mot de passe est haché avec **argon2id** (sel par utilisateur, paramètres OWASP 2024) avant que quoi que ce soit touche la base. Le mot de passe en clair n'est jamais stocké.
- L'endpoint d'onboarding est protégé par un **verrou anti-takeover** : une fois le premier utilisateur créé, toute autre tentative d'onboarding est refusée. Cela empêche quelqu'un sur votre LAN de vous prendre de vitesse sur votre propre instance.

Choisissez un mot de passe solide et stockez-le dans un gestionnaire de mots de passe. Athena n'a pas de flux « j'ai oublié mon mot de passe » par email car il n'envoie pas d'email.

## Mettre à jour

Depuis le dossier du checkout, lancez :

```bash
./update.sh
```

`update.sh` fait un `git pull --rebase` en fast-forward, reconstruit les conteneurs `backend` et `frontend` avec `--no-cache`, relance la stack en tâche de fond (`docker compose up -d --build`), et supprime les images orphelines laissées par le rebuild. Postgres est une image standard et **n'est pas** reconstruit, votre volume de données est donc préservé intact.

Le script est safe à rejouer — s'il n'y a pas de nouveaux commits et que les deux conteneurs sont déjà up, il se termine tôt sans rien toucher. Si le pull n'a rien apporté mais qu'un conteneur est arrêté, il le démarre.

Vous pouvez le brancher sur un cron pour un auto-update homelab léger ; une cadence raisonnable est une fois par jour aux heures creuses :

```cron
0 4 * * * /path/to/Athena-Accounting/update.sh >> /var/log/athena-update.log 2>&1
```

Les utilisateurs de la version bureau mettent à jour en téléchargeant le dernier installateur depuis la [page Releases](https://github.com/Gekkotron/Athena-Accounting/releases) et en le lançant par-dessus l'application existante — le dossier de données est intact.

## Vos dix premières minutes

Une fois connecté :

1. **Créez un compte.** *Comptes → Ajouter*. Donnez-lui un nom, une devise, un solde d'ouverture et une date d'ouverture. Chaque solde affiché est calculé comme `solde_ouverture + SUM(montant WHERE date >= date_ouverture)`, donc bien caler la paire d'ouverture compte. Si vous n'êtes pas sûr de la valeur, prenez le solde le plus ancien visible sur votre relevé — vous pourrez le corriger plus tard avec un point de contrôle.

2. **Importez un relevé.** *Imports → glisser le fichier*. OFX et CSV s'importent immédiatement. Le premier PDF d'une nouvelle banque ouvre l'assistant de modèle — voir **[Importer](importing.md)**.

3. **Regardez le tableau de bord.** Vous verrez une courbe de solde, un donut par catégorie (surtout vide au début — tout est non catégorisé), et un panneau d'insights.

4. **Catégorisez quelques transactions.** *Tri → cliquez sur un mot-clé → « Générer une règle »*. Chaque future transaction correspondant à ce mot-clé sera catégorisée automatiquement. Voir **[Catégorisation](categorization.md)** pour les détails.

5. **Fixez un budget** (optionnel). *Budgets → choisissez une catégorie → montant mensuel*. Le tableau de bord affiche prévu vs réalisé.

## Où aller ensuite

- **[Importer](importing.md)** — la fonctionnalité phare, en particulier l'assistant de modèle PDF.
- **[Catégorisation](categorization.md)** — comment fonctionne le moteur de règles.
- **[Tableau de bord](dashboard.md)** — les widgets en détail.
- **[Comptes et données](accounts-and-data.md)** — faites un export de sauvegarde avant d'avoir beaucoup de données à perdre.

← [Retour aux docs utilisateur](README.md)
