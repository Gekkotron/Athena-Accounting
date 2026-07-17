export type AmountMode = 'signed' | 'pair';
export type Step = 'header' | 'table' | 'date' | 'description' | 'amount';

export const STEP_ORDER: Step[] = ['header', 'table', 'date', 'description', 'amount'];

// Step titles (StepIndicator pills) and tooltips (InfoTip hover text) are
// translated — see the `steps.<step>.title` / `steps.<step>.tooltip` keys in
// the `pdf-template` namespace. This map only carries the i18n key suffix for
// each step so callers can build `steps.${STEP_ORDER[i]}.title` etc.

// Sage and clay map to the project's tailwind tokens.
export const PAINT_COLOR: Partial<Record<Step, string>> = {
  header: '#7dd3c0',
  table: '#7dd3c0',
  date: '#7dd3c0',
  description: '#7dd3c0',
  amount: '#e69782',
};
