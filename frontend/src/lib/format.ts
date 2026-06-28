export function formatAmount(value: string | number, currency = 'EUR'): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return String(value);
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function formatDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso;
  const [y, m, d] = iso.split('T')[0]!.split('-');
  return `${d}/${m}/${y}`;
}

export function formatDateTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('fr-FR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function amountSignClass(value: string | number): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n) || n === 0) return 'text-slate-300';
  return n > 0 ? 'text-emerald-400' : 'text-rose-300';
}
