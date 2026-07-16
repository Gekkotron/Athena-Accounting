// Central registry for tip ids and their French copy. The array below
// must stay in lock-step with backend/src/http/routes/tips/tip-ids.ts;
// a Vitest test in Task 4 asserts literal equality.

export const TIP_IDS = [
  'welcome_tour',
  'section:dashboard',
  'section:imports',
  'section:transactions',
  'section:rules',
  'section:budgets',
  'section:accounts',
  'section:data',
] as const;

export type TipId = typeof TIP_IDS[number];

export const SECTION_TIPS: Record<
  Exclude<TipId, 'welcome_tour'>,
  { title: string; body: string }
> = {
  'section:dashboard': {
    title: 'Bienvenue sur le tableau de bord',
    body: "Vous y voyez le solde de vos comptes, la courbe du solde et vos dépenses par catégorie. Cliquez sur une catégorie du donut pour filtrer les transactions.",
  },
  'section:imports': {
    title: 'Importer vos relevés',
    body: "Glissez un fichier OFX, CSV ou PDF. La première fois qu'un PDF d'une banque est importé, un assistant vous demande de désigner les zones montant/date/libellé — les imports suivants sont automatiques.",
  },
  'section:transactions': {
    title: 'Rechercher, corriger, ventiler',
    body: "La recherche ignore les accents et la casse. Vous pouvez ventiler une transaction en plusieurs sous-lignes, éditer une catégorie en ligne, ou sélectionner plusieurs transactions pour les supprimer d'un coup.",
  },
  'section:rules': {
    title: 'Catégorisation automatique',
    body: "Les règles s'appliquent aux nouveaux imports et peuvent être ré-appliquées rétroactivement sans écraser vos catégories manuelles. Depuis l'onglet Tri, vous pouvez créer une règle à partir d'un mot-clé en un clic.",
  },
  'section:budgets': {
    title: 'Suivi de budget mensuel',
    body: "Pour chaque catégorie de dépenses, définissez un montant prévu et suivez l'écart en temps réel. Les catégories en dépassement passent au rouge.",
  },
  'section:accounts': {
    title: 'Vos comptes',
    body: "Ajoutez un compte courant, un livret, un PEA… Le solde de départ est obligatoire : tous les soldes sont calculés à partir de là. L'argent bloqué (PEA, dépôt à terme) est isolé du montant disponible.",
  },
  'section:data': {
    title: 'Sauvegarde et restauration',
    body: "Exportez un backup complet (comptes, transactions, checkpoints, ventilations) et ré-importez-le sur une autre installation ou pour restaurer.",
  },
};

export const WELCOME_STEPS: Array<{ title: string; body: string }> = [
  {
    title: 'Bienvenue dans Athena',
    body: 'Athena est un logiciel de comptabilité personnel auto-hébergé. Vos données bancaires ne quittent pas votre réseau.',
  },
  {
    title: 'Créez vos comptes',
    body: 'Commencez par ajouter vos comptes bancaires dans « Comptes ». Le solde de départ et la date d\'ouverture servent de base à tous les calculs.',
  },
  {
    title: 'Importez vos relevés',
    body: 'Depuis « Données › Imports », glissez vos fichiers OFX, CSV ou PDF. Les doublons sont détectés automatiquement.',
  },
  {
    title: 'Analysez vos dépenses',
    body: 'Le tableau de bord affiche votre solde et vos dépenses par catégorie. Définissez ensuite des budgets mensuels si vous le souhaitez.',
  },
];
