export type AmountMode = 'signed' | 'pair';
export type Step = 'header' | 'table' | 'date' | 'description' | 'amount';

export const STEP_ORDER: Step[] = ['header', 'table', 'date', 'description', 'amount'];

export const STEP_TITLE: Record<Step, string> = {
  header: "Sélectionnez l'en-tête",
  table: 'Sélectionnez le tableau des transactions',
  date: 'Sélectionnez la colonne Date',
  description: 'Sélectionnez la colonne Libellé',
  amount: 'Sélectionnez la colonne Montant',
};

// Long-form guidance surfaced by a hover tooltip next to each step's title.
// Kept in one place so the whole flow reads like a cohesive tutorial.
export const STEP_TOOLTIP: Record<Step, string> = {
  header:
    "Tracez autour du logo / titre de la banque en haut de la page. Cette zone sert d'empreinte : la prochaine fois que vous importerez un relevé de la même banque, Athena reconnaîtra le template automatiquement.",
  table:
    "Tracez autour de tout le tableau des transactions, en-tête de colonnes inclus. N'incluez pas les totaux ou le pied de page — juste les lignes de mouvement.",
  date:
    "Tracez une bande verticale fine qui couvre uniquement la colonne des dates, à l'intérieur du tableau que vous venez de délimiter. La hauteur n'a pas d'importance : Athena utilise seulement les bornes gauche/droite.",
  description:
    "Tracez la colonne du libellé (nom du commerçant / motif). Peut être large : les colonnes voisines seront ignorées grâce aux bornes de chaque colonne.",
  amount:
    "Choisissez d'abord si votre banque affiche un seul montant signé (+ / −) ou deux colonnes Débit + Crédit. Puis tracez les colonnes correspondantes. Donnez enfin un nom au template pour le retrouver plus tard.",
};

// Sage and clay map to the project's tailwind tokens.
export const PAINT_COLOR: Partial<Record<Step, string>> = {
  header: '#7dd3c0',
  table: '#7dd3c0',
  date: '#7dd3c0',
  description: '#7dd3c0',
  amount: '#e69782',
};
